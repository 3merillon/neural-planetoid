import type { ChunkWorkMessage, ChunkWorkResult } from "./chunk-worker";
import { ChunkConfigManager } from "./chunk-config";

export interface WorkerTask {
    originX: number;
    originY: number;
    originZ: number;
    worldSize: number;
    voxelGridSize: number;
    lodLevel: number;
    isoLevelBias: number;
    seed: number;
    resolve: (result: ChunkWorkResult) => void;
    reject: (error: Error) => void;
    priority: number;
    timestamp: number;
    isVisible: boolean;
    distanceToCamera: number;
    nodeId: string;
}

interface ActiveTask {
    task: WorkerTask;
    workerId: number;
}

export class WorkerManager {
    private workers: Worker[] = [];
    private availableWorkers: number[] = [];
    private busyWorkers: Set<number> = new Set();
    private taskQueue: WorkerTask[] = [];
    private activeTasks: Map<number, ActiveTask> = new Map();
    private maxWorkers: number;
    private configManager: ChunkConfigManager;
    private currentCameraPos: [number, number, number] = [0, 0, 0];
    private maxLodLevel: number = 4;
    
    private readonly SOFT_QUEUE_LIMIT = 80;
    private readonly HARD_QUEUE_LIMIT = 120;
    private readonly VISIBLE_PRIORITY_BASE = 1000000;
    private readonly NON_VISIBLE_PRIORITY_BASE = 10000;

    constructor(maxWorkers: number = navigator.hardwareConcurrency || 4) {
        this.maxWorkers = Math.min(maxWorkers, 8);
        this.configManager = ChunkConfigManager.getInstance();
        this.maxLodLevel = this.configManager.getWorldConfig().numLODLevels - 1;
        this.initializeWorkers();
    }

    private initializeWorkers(): void {
        for (let i = 0; i < this.maxWorkers; i++) {
            const worker = new Worker(
                new URL('./chunk-worker.ts', import.meta.url),
                { type: "module" }
            );
            worker.onmessage = (e: MessageEvent<ChunkWorkResult>) => {
                this.handleWorkerMessage(e.data, i);
            };
            worker.onerror = (e: ErrorEvent) => {
                this.handleWorkerError(e, i);
            };
            this.workers[i] = worker;
            this.availableWorkers.push(i);
        }
    }

    private handleWorkerMessage(result: ChunkWorkResult, workerId: number): void {
        const activeTask = this.activeTasks.get(workerId);
        if (activeTask) {
            const { task } = activeTask;
            if (result.type === 'complete') {
                task.resolve(result);
            } else if (result.type === 'error') {
                task.reject(new Error(result.error || 'Unknown worker error'));
            }
            this.activeTasks.delete(workerId);
        }
        this.busyWorkers.delete(workerId);
        this.availableWorkers.push(workerId);
        this.processNextTask();
    }

    private handleWorkerError(e: ErrorEvent, workerId: number): void {
        const activeTask = this.activeTasks.get(workerId);
        if (activeTask) {
            activeTask.task.reject(new Error(`Worker ${workerId} error: ${e.message}`));
            this.activeTasks.delete(workerId);
        }
        this.busyWorkers.delete(workerId);
        this.availableWorkers.push(workerId);
        this.processNextTask();
    }

    private calculatePriority(
        lodLevel: number, 
        originX: number, 
        originY: number, 
        originZ: number,
        isVisible: boolean,
        distanceToCamera: number
    ): number {
        const lodPriorityMultiplier = Math.pow(10, lodLevel);
        const distancePenalty = Math.min(distanceToCamera * 0.1, 50000);
        
        if (isVisible) {
            if (lodLevel === 0) {
                return this.VISIBLE_PRIORITY_BASE + 500000 - distancePenalty;
            }
            return this.VISIBLE_PRIORITY_BASE + (lodPriorityMultiplier * 1000) - distancePenalty;
        } else {
            if (lodLevel === 0) {
                return this.NON_VISIBLE_PRIORITY_BASE + 5000 - distancePenalty;
            }
            return this.NON_VISIBLE_PRIORITY_BASE + (lodPriorityMultiplier * 10) - distancePenalty;
        }
    }

    private smartEviction(newTask: WorkerTask): boolean {
        if (this.taskQueue.length >= this.HARD_QUEUE_LIMIT) {
            let evictionIndex = -1;
            let lowestPriority = Infinity;
            
            for (let i = 0; i < this.taskQueue.length; i++) {
                const task = this.taskQueue[i];
                if (!task.isVisible && task.priority < lowestPriority) {
                    lowestPriority = task.priority;
                    evictionIndex = i;
                }
            }
            
            if (evictionIndex === -1) {
                for (let i = 0; i < this.taskQueue.length; i++) {
                    const task = this.taskQueue[i];
                    if (task.priority < lowestPriority) {
                        lowestPriority = task.priority;
                        evictionIndex = i;
                    }
                }
            }
            
            if (evictionIndex !== -1 && newTask.priority > lowestPriority) {
                const evictedTask = this.taskQueue.splice(evictionIndex, 1)[0];
                evictedTask.reject(new Error('Task evicted for higher priority task'));
                return true;
            } else {
                return false;
            }
        }
        
        return true;
    }

    private insertTaskByPriority(task: WorkerTask): boolean {
        const existingIndex = this.taskQueue.findIndex(t => t.nodeId === task.nodeId);
        if (existingIndex !== -1) {
            if (this.taskQueue[existingIndex].priority < task.priority) {
                this.taskQueue.splice(existingIndex, 1);
            } else {
                return false;
            }
        }

        if (!this.smartEviction(task)) {
            return false;
        }

        let insertIndex = 0;
        for (let i = 0; i < this.taskQueue.length; i++) {
            if (this.taskQueue[i].priority < task.priority) {
                insertIndex = i;
                break;
            }
            insertIndex = i + 1;
        }
        this.taskQueue.splice(insertIndex, 0, task);
        return true;
    }

    public updateCameraPosition(cameraPos: [number, number, number]): void {
        this.currentCameraPos = cameraPos;
        this.continuousPriorityUpdate();
    }

    private continuousPriorityUpdate(): void {
        const now = performance.now();
        const maxAge = 2000;
        
        this.taskQueue = this.taskQueue.filter(task => {
            const isOld = (now - task.timestamp) > maxAge;
            if (isOld) {
                task.reject(new Error('Task expired due to age'));
            }
            return !isOld;
        });
        
        for (const task of this.taskQueue) {
            const dx = task.originX + task.worldSize/2 - this.currentCameraPos[0];
            const dy = task.originY + task.worldSize/2 - this.currentCameraPos[1];
            const dz = task.originZ + task.worldSize/2 - this.currentCameraPos[2];
            task.distanceToCamera = Math.sqrt(dx*dx + dy*dy + dz*dz);
            
            task.priority = this.calculatePriority(
                task.lodLevel, 
                task.originX, 
                task.originY, 
                task.originZ,
                task.isVisible,
                task.distanceToCamera
            );
        }
        
        this.taskQueue.sort((a, b) => b.priority - a.priority);
        
        if (this.taskQueue.length > this.SOFT_QUEUE_LIMIT) {
            this.taskQueue = this.taskQueue.filter(task => {
                const shouldKeep = task.isVisible || task.priority > 1000;
                if (!shouldKeep) {
                    task.reject(new Error('Task pruned due to low priority'));
                }
                return shouldKeep;
            });
        }
    }

    public generateChunk(
        originX: number,
        originY: number,
        originZ: number,
        worldSize: number,
        voxelGridSize: number,
        lodLevel: number = 0,
        isoLevelBias: number = 0,
        seed: number = 1337,
        isVisible: boolean = false,
        nodeId: string = `${originX}_${originY}_${originZ}_${lodLevel}`
    ): Promise<ChunkWorkResult> {
        return new Promise((resolve, reject) => {
            const dx = originX + worldSize/2 - this.currentCameraPos[0];
            const dy = originY + worldSize/2 - this.currentCameraPos[1];
            const dz = originZ + worldSize/2 - this.currentCameraPos[2];
            const distanceToCamera = Math.sqrt(dx*dx + dy*dy + dz*dz);
            
            const priority = this.calculatePriority(
                lodLevel, originX, originY, originZ, isVisible, distanceToCamera
            );
            
            if (this.taskQueue.length > this.SOFT_QUEUE_LIMIT && 
                !isVisible && 
                priority < this.NON_VISIBLE_PRIORITY_BASE) {
                reject(new Error('Queue full - low priority task rejected'));
                return;
            }
            
            const task: WorkerTask = {
                originX,
                originY,
                originZ,
                worldSize,
                voxelGridSize,
                lodLevel,
                isoLevelBias,
                seed,
                resolve,
                reject,
                priority,
                timestamp: performance.now(),
                isVisible,
                distanceToCamera,
                nodeId
            };
            
            const wasInserted = this.insertTaskByPriority(task);
            if (!wasInserted) {
                reject(new Error('Task rejected - queue management'));
                return;
            }
            
            this.processNextTask();
        });
    }

    private processNextTask(): void {
        if (this.taskQueue.length === 0 || this.availableWorkers.length === 0) {
            return;
        }
        
        const task = this.taskQueue.shift()!;
        const workerId = this.availableWorkers.shift()!;
        this.busyWorkers.add(workerId);
        this.activeTasks.set(workerId, { task, workerId });
        
        const worker = this.workers[workerId];
        const message: ChunkWorkMessage = {
            type: 'generate',
            originX: task.originX,
            originY: task.originY,
            originZ: task.originZ,
            worldSize: task.worldSize,
            voxelGridSize: task.voxelGridSize,
            workerId,
            lodLevel: task.lodLevel,
            isoLevelBias: task.isoLevelBias,
            seed: task.seed
        };
        worker.postMessage(message);
    }

    public getStats() {
        const config = this.configManager.getConfig();
        const numLODs = config.lodLevels.length;
        const queueByLOD = new Array(numLODs).fill(0);
        const visibleInQueue = this.taskQueue.filter(t => t.isVisible).length;
        const highPriorityInQueue = this.taskQueue.filter(t => t.priority > this.NON_VISIBLE_PRIORITY_BASE).length;
        
        for (const task of this.taskQueue) {
            if (task.lodLevel >= 0 && task.lodLevel < numLODs) {
                queueByLOD[task.lodLevel]++;
            }
        }
        
        return {
            totalWorkers: this.maxWorkers,
            availableWorkers: this.availableWorkers.length,
            busyWorkers: this.busyWorkers.size,
            queuedTasks: this.taskQueue.length,
            visibleInQueue,
            highPriorityInQueue,
            activeTasks: this.activeTasks.size,
            queueByLOD: queueByLOD,
            maxLodLevel: this.maxLodLevel,
            softLimit: this.SOFT_QUEUE_LIMIT,
            hardLimit: this.HARD_QUEUE_LIMIT,
            queuePressure: this.taskQueue.length / this.HARD_QUEUE_LIMIT
        };
    }

    public terminate(): void {
        for (const worker of this.workers) {
            worker.terminate();
        }
        this.workers = [];
        this.availableWorkers = [];
        this.busyWorkers.clear();
        this.taskQueue = [];
        this.activeTasks.clear();
    }
}