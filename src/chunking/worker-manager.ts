import { createChunkWorker } from "./chunk-worker";
import type { ChunkWorkMessage, ChunkWorkResult } from "./chunk-worker";
import { ChunkConfigManager } from "./chunk-config";

export interface WorkerTask {
    chunkX: number;
    chunkY: number;
    chunkZ: number;
    worldSize: number;
    voxelGridSize: number;
    lodLevel: number;
    isoLevelBias: number;
    seed: number;
    resolve: (result: ChunkWorkResult) => void;
    reject: (error: Error) => void;
    priority: number;
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

    constructor(maxWorkers: number = navigator.hardwareConcurrency || 4) {
        this.maxWorkers = Math.min(maxWorkers, 8);
        this.configManager = ChunkConfigManager.getInstance();
        this.initializeWorkers();
    }

    private initializeWorkers(): void {
        for (let i = 0; i < this.maxWorkers; i++) {
            const worker = createChunkWorker(i);
            
            worker.onmessage = (e: MessageEvent<ChunkWorkResult>) => {
                this.handleWorkerMessage(e.data, i);
            };
            
            worker.onerror = (e: ErrorEvent) => {
                this.handleWorkerError(e, i);
            };
            
            this.workers[i] = worker;
            this.availableWorkers.push(i);
        }
        
        //console.log(`Initialized ${this.maxWorkers} chunk generation workers`);
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
        //console.error(`Worker ${workerId} error:`, e);
        
        const activeTask = this.activeTasks.get(workerId);
        if (activeTask) {
            activeTask.task.reject(new Error(`Worker ${workerId} error: ${e.message}`));
            this.activeTasks.delete(workerId);
        }
        
        this.busyWorkers.delete(workerId);
        this.availableWorkers.push(workerId);
        this.processNextTask();
    }

    private calculatePriority(lodLevel: number, chunkX: number, chunkY: number, chunkZ: number): number {
        // Dynamic priority calculation based on current LOD configuration
        const config = this.configManager.getConfig();
        const numLODs = config.lodLevels.length;
        
        // Higher priority = processed first
        // L0 gets massive priority boost to always be first
        let basePriority = 0;
        
        if (lodLevel === 0) {
            basePriority = 10000; // L0 always gets highest priority
        } else if (lodLevel < numLODs) {
            // Exponential decay for higher LODs
            basePriority = Math.max(10, 10000 / Math.pow(2, lodLevel));
        } else {
            basePriority = 10; // Fallback for unexpected LOD levels
        }
        
        // Add small distance-based priority (closer chunks slightly higher priority)
        // This ensures that within the same LOD level, closer chunks are processed first
        const distancePriority = 1000 - (Math.abs(chunkX) + Math.abs(chunkY) + Math.abs(chunkZ));
        
        return basePriority + Math.max(0, Math.min(distancePriority, 999));
    }

    private insertTaskByPriority(task: WorkerTask): void {
        // Insert task in priority order (highest priority first)
        let insertIndex = 0;
        for (let i = 0; i < this.taskQueue.length; i++) {
            if (this.taskQueue[i].priority < task.priority) {
                insertIndex = i;
                break;
            }
            insertIndex = i + 1;
        }
        this.taskQueue.splice(insertIndex, 0, task);
    }

    public generateChunk(
        chunkX: number,
        chunkY: number,
        chunkZ: number,
        worldSize: number,
        voxelGridSize: number,
        lodLevel: number = 0,
        isoLevelBias: number = 0,
        seed: number = 1337
    ): Promise<ChunkWorkResult> {
        return new Promise((resolve, reject) => {
            const priority = this.calculatePriority(lodLevel, chunkX, chunkY, chunkZ);
            const task: WorkerTask = {
                chunkX,
                chunkY,
                chunkZ,
                worldSize,
                voxelGridSize,
                lodLevel,
                isoLevelBias,
                seed,
                resolve,
                reject,
                priority
            };
            this.insertTaskByPriority(task);
            this.processNextTask();
        });
    }

    private processNextTask(): void {
        if (this.taskQueue.length === 0 || this.availableWorkers.length === 0) {
            return;
        }
        
        // Take the highest priority task (first in queue)
        const task = this.taskQueue.shift()!;
        const workerId = this.availableWorkers.shift()!;
        
        this.busyWorkers.add(workerId);
        this.activeTasks.set(workerId, { task, workerId });
        
        const worker = this.workers[workerId];
        
        const message: ChunkWorkMessage = {
            type: 'generate',
            chunkX: task.chunkX,
            chunkY: task.chunkY,
            chunkZ: task.chunkZ,
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
        // Dynamic queue stats by LOD level
        const config = this.configManager.getConfig();
        const numLODs = config.lodLevels.length;
        const queueByLOD = new Array(numLODs).fill(0);
        
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
            activeTasks: this.activeTasks.size,
            queueByLOD: queueByLOD
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