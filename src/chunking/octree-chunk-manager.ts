import { OctreeNode, NodeState, CullState } from "./octree-node";
import { Chunk } from "./chunk";
import { MarchingCubes } from "../marching-cubes-wasm/marching_cubes";
import { computeNormalsFieldGradientJS } from "./field-gradient";
import { mat4, vec3 } from "gl-matrix";
import { ChunkConfigManager } from "./chunk-config";
import { WorkerManager } from "./worker-manager";
import { Frustum, FrustumResult } from "./frustum-culling";
import { MaterialSystem, type MaterialWeights } from "./material-system";
import { PLANET_RADIUS } from "./density";

interface GenerationRequest {
    node: OctreeNode;
    priority: number;
    isVisible: boolean;
    timestamp: number;
    isInitial: boolean;
    isPredictive: boolean;
    isEssentialDependency: boolean;
    dependencyLevel: number;
}

export class OctreeChunkManager {
    private configManager: ChunkConfigManager;
    private workerManager: WorkerManager;
    private frustum: Frustum;
    private root: OctreeNode;
    private generationQueue: GenerationRequest[] = [];
    private essentialQueue: GenerationRequest[] = [];
    private pendingNodes: Set<OctreeNode> = new Set();
    private completedNodes: Set<OctreeNode> = new Set();
    private lastUpdateTime: number = 0;
    private rootInitialized: boolean = false;
    private initialGenerationComplete: boolean = false;
    private initializationPhase: number = 0;
    private essentialNodesComplete: boolean = false;
    private frameStats = {
        nodesTraversed: 0,
        nodesVisible: 0,
        nodesCulled: 0,
        chunksRendered: 0,
        memoryUsage: 0
    };
    private lastCameraPos: [number, number, number] = [0, 0, 0];
    private previousCameraPos: [number, number, number] = [0, 0, 0];
    private cameraVelocity: [number, number, number] = [0, 0, 0];
    private lastPruneTime: number = 0;
    private readonly MAX_LOCAL_QUEUE_SIZE = 40;
    private readonly MAX_ESSENTIAL_QUEUE_SIZE = 20;
    private readonly PREDICTION_DISTANCE_MULTIPLIER = 2.0;

    constructor(
        public marchingCubes: MarchingCubes,
        public gl: WebGL2RenderingContext,
        public shader: any,
        public uniforms: any
    ) {
        this.configManager = ChunkConfigManager.getInstance();
        const cfg = this.configManager.getConfig();
        this.workerManager = new WorkerManager(cfg.maxWorkers);
        this.frustum = new Frustum();
        
        this.frustum.setPlanetCenter(vec3.fromValues(0, 0, 0));
        
        const rootSize = this.configManager.calculateRootOctreeSize();
        const rootCenter = vec3.fromValues(0, 0, 0);
        const rootVoxelGridSize = Math.max(32, cfg.voxelGridSize);
        this.configManager.setRootOctreeSize(rootSize);
        this.root = new OctreeNode(rootCenter, rootSize, 0, rootVoxelGridSize);
        
        this.initializeSystematically();
    }

    private getMaxLevel(): number {
        const worldConfig = this.configManager.getWorldConfig();
        return worldConfig.numLODLevels - 1;
    }

    private async initializeSystematically(): Promise<void> {
        this.initializationPhase = 1;
        
        await this.generateRootNode();
        
        await this.generateLevel1Nodes();
        
        this.essentialNodesComplete = true;
        
        this.initializationPhase = 3;
        this.initialGenerationComplete = true;
        this.rootInitialized = true;
    }

    private async generateRootNode(): Promise<void> {
        return new Promise((resolve) => {
            const checkRootComplete = () => {
                if (this.root.state === NodeState.READY && this.root.geometryTested) {
                    resolve();
                } else {
                    if (!this.pendingNodes.has(this.root) && this.root.state !== NodeState.GENERATING) {
                        this.queueNodeGeneration(this.root, true, true);
                    }
                    setTimeout(checkRootComplete, 50);
                }
            };
            
            this.queueNodeGeneration(this.root, true, true);
            checkRootComplete();
        });
    }

    private async generateLevel1Nodes(): Promise<void> {
        this.initializationPhase = 2;
        
        if (!this.root.children) {
            this.root.createChildren();
        }
        
        if (!this.root.children) {
            return;
        }
        
        const level1Promises: Promise<void>[] = [];
        
        for (let i = 0; i < this.root.children.length; i++) {
            const child = this.root.children[i];
            const promise = new Promise<void>((resolve) => {
                const checkChildComplete = () => {
                    if (child.state === NodeState.READY && child.geometryTested) {
                        resolve();
                    } else {
                        if (!this.pendingNodes.has(child) && child.state !== NodeState.GENERATING) {
                            this.queueNodeGeneration(child, true, true);
                        }
                        setTimeout(checkChildComplete, 50);
                    }
                };
                
                this.queueNodeGeneration(child, true, true);
                checkChildComplete();
            });
            
            level1Promises.push(promise);
        }
        
        await Promise.all(level1Promises);
    }

    public update(cameraPos: [number, number, number], projectionViewMatrix?: mat4): void {
        const currentTime = performance.now();
        this.lastUpdateTime = currentTime;
        
        this.updateCameraVelocity(cameraPos);
        
        this.previousCameraPos = [...this.lastCameraPos];
        this.lastCameraPos = cameraPos;
        
        this.workerManager.updateCameraPosition(cameraPos);
        
        if (currentTime - this.lastPruneTime > 150) {
            this.pruneLocalQueue();
            this.lastPruneTime = currentTime;
        }
        
        this.frameStats = {
            nodesTraversed: 0,
            nodesVisible: 0,
            nodesCulled: 0,
            chunksRendered: 0,
            memoryUsage: 0
        };
        
        if (projectionViewMatrix) {
            this.frustum.updateFromMatrix(projectionViewMatrix);
        }
        
        const cameraVec = vec3.fromValues(cameraPos[0], cameraPos[1], cameraPos[2]);
        
        this.processGenerationQueue();
        
        if (this.essentialNodesComplete) {
            this.updateOctreeStructureIterative(this.root, cameraVec);
            this.generatePredictiveChunks(cameraVec);
        } else {
            this.updateDistancesOnly(this.root, cameraVec);
        }
        
        this.frameStats.memoryUsage = this.root.getMemoryFootprint();
    }

    private updateCameraVelocity(cameraPos: [number, number, number]): void {
        if (this.lastCameraPos) {
            this.cameraVelocity[0] = cameraPos[0] - this.lastCameraPos[0];
            this.cameraVelocity[1] = cameraPos[1] - this.lastCameraPos[1];
            this.cameraVelocity[2] = cameraPos[2] - this.lastCameraPos[2];
        }
    }

    private generatePredictiveChunks(cameraPos: vec3): void {
        const speed = Math.sqrt(
            this.cameraVelocity[0] * this.cameraVelocity[0] +
            this.cameraVelocity[1] * this.cameraVelocity[1] +
            this.cameraVelocity[2] * this.cameraVelocity[2]
        );
        
        if (speed < 0.1 || this.generationQueue.length > this.MAX_LOCAL_QUEUE_SIZE * 0.6) {
            return;
        }
        
        const futurePos = vec3.fromValues(
            cameraPos[0] + this.cameraVelocity[0] * this.PREDICTION_DISTANCE_MULTIPLIER,
            cameraPos[1] + this.cameraVelocity[1] * this.PREDICTION_DISTANCE_MULTIPLIER,
            cameraPos[2] + this.cameraVelocity[2] * this.PREDICTION_DISTANCE_MULTIPLIER
        );
        
        this.findPredictiveSubdivisionCandidates(this.root, futurePos);
    }

    private findPredictiveSubdivisionCandidates(node: OctreeNode, futurePos: vec3): void {
        if (!node.hasConfirmedGeometry() || node.children) {
            if (node.children) {
                for (const child of node.children) {
                    this.findPredictiveSubdivisionCandidates(child, futurePos);
                }
            }
            return;
        }
        
        const futureDistance = vec3.distance(node.bounds.center, futurePos);
        const maxLevel = this.getMaxLevel();
        
        if (node.level < maxLevel && futureDistance < node.getSubdivisionInfo().subdivisionDistance) {
            this.queuePredictiveSubdivision(node, futurePos);
        }
    }

    private queuePredictiveSubdivision(node: OctreeNode, futurePos: vec3): void {
        if (node.children) return;
        
        const childSize = node.bounds.size / 2;
        const childVoxelGridSize = Math.max(8, node.voxelGridSize);
        
        for (let x = 0; x < 2; x++) {
            for (let y = 0; y < 2; y++) {
                for (let z = 0; z < 2; z++) {
                    const childCenter = vec3.fromValues(
                        node.bounds.center[0] + (x - 0.5) * childSize,
                        node.bounds.center[1] + (y - 0.5) * childSize,
                        node.bounds.center[2] + (z - 0.5) * childSize
                    );
                    
                    const distanceFromFuture = vec3.distance(childCenter, futurePos);
                    
                    if (distanceFromFuture < node.bounds.size * 3) {
                        const tempChild = new OctreeNode(
                            childCenter,
                            childSize,
                            node.level + 1,
                            childVoxelGridSize,
                            node
                        );
                        tempChild.updateDistanceToCamera(futurePos);
                        
                        this.queueNodeGeneration(tempChild, false, false, true);
                    }
                }
            }
        }
    }

    private isEssentialDependency(node: OctreeNode): boolean {
        if (node.level > 2) return false;
        
        return this.hasVisibleDescendants(node);
    }

    private hasVisibleDescendants(node: OctreeNode): boolean {
        const stack: OctreeNode[] = [node];
        
        while (stack.length > 0) {
            const current = stack.pop()!;
            
            if (current !== node && current.isVisible) {
                return true;
            }
            
            if (current.children) {
                for (const child of current.children) {
                    stack.push(child);
                }
            }
        }
        
        return false;
    }

    private pruneLocalQueue(): void {
        const now = performance.now();
        const maxAge = 3000;
        
        this.essentialQueue = this.essentialQueue.filter(request => {
            const isOld = (now - request.timestamp) > maxAge;
            const stillNeeded = this.isEssentialDependency(request.node);
            
            if (isOld && !stillNeeded) {
                this.pendingNodes.delete(request.node);
                request.node.state = NodeState.EMPTY;
                return false;
            }
            return true;
        });
        
        this.generationQueue = this.generationQueue.filter(request => {
            const isOld = (now - request.timestamp) > maxAge;
            if (isOld) {
                this.pendingNodes.delete(request.node);
                if (!request.isPredictive) {
                    request.node.state = NodeState.EMPTY;
                }
            }
            return !isOld;
        });
        
        if (this.generationQueue.length > this.MAX_LOCAL_QUEUE_SIZE) {
            this.generationQueue.sort((a, b) => {
                if (a.isVisible !== b.isVisible) {
                    return a.isVisible ? -1 : 1;
                }
                return b.priority - a.priority;
            });
            
            const excess = this.generationQueue.splice(this.MAX_LOCAL_QUEUE_SIZE);
            for (const request of excess) {
                this.pendingNodes.delete(request.node);
                if (!request.isPredictive) {
                    request.node.state = NodeState.EMPTY;
                }
            }
        }
        
        for (const request of [...this.essentialQueue, ...this.generationQueue]) {
            request.node.updateDistanceToCamera(vec3.fromValues(...this.lastCameraPos));
            request.priority = this.calculatePriority(request.node, request.isVisible, request.isInitial, request.isPredictive);
        }
        
        this.essentialQueue.sort((a, b) => {
            if (a.node.level !== b.node.level) {
                return a.node.level - b.node.level;
            }
            return b.priority - a.priority;
        });
        
        this.generationQueue.sort((a, b) => {
            if (a.isVisible !== b.isVisible) {
                return a.isVisible ? -1 : 1;
            }
            if (a.isVisible && b.isVisible) {
                return b.node.level - a.node.level;
            }
            return b.priority - a.priority;
        });
    }

    private updateDistancesOnly(node: OctreeNode, cameraPos: vec3): void {
        const stack: OctreeNode[] = [node];
        
        while (stack.length > 0) {
            const currentNode = stack.pop()!;
            currentNode.updateDistanceToCamera(cameraPos);
            currentNode.isVisible = true;
            
            if (currentNode.children) {
                for (const child of currentNode.children) {
                    stack.push(child);
                }
            }
        }
    }

    private updateOctreeStructureIterative(root: OctreeNode, cameraPos: vec3): void {
        const frameId = this.lastUpdateTime;
        const stack: OctreeNode[] = [root];

        while (stack.length > 0) {
            const node = stack.pop()!;
            node.updateDistanceToCamera(cameraPos);

            const wasVisible = node.isVisible;

            if (node.lastOcclusionFrame !== frameId) {
                const aabb = { min: node.bounds.min, max: node.bounds.max };
                node.lastOcclusionResult = this.frustum.testAABBWithPlanetOcclusion(aabb, cameraPos);
                node.lastOcclusionFrame = frameId;
            }
            const occlusionResult = node.lastOcclusionResult;
            node.isVisible = (occlusionResult !== FrustumResult.OUTSIDE);
            node.lastVisibilityCheck = frameId;

            if (occlusionResult === FrustumResult.OUTSIDE) {
                this.frameStats.nodesCulled++;
                continue;
            }
            if (node.isVisible) {
                this.frameStats.nodesVisible++;
            }

            if (
                node.isVisible &&
                !wasVisible &&
                !node.geometryTested &&
                !this.pendingNodes.has(node)
            ) {
                this.queueNodeGeneration(node, true);
            }

            if (
                node.isVisible &&
                !node.geometryTested &&
                !this.pendingNodes.has(node)
            ) {
                this.queueNodeGeneration(node, true);
            }

            if (node.isVisible && node.geometryTested && !node.hasGeometry) {
                node.geometryTested = false;
                node.hasGeometry = false;
                node.cullState = CullState.UNKNOWN;
            }

            if (node.cullState === CullState.UNKNOWN) {
                const seed = this.configManager.getSeed();
                const isoLevelBias = this.configManager.getIsoLevelBias();
                node.performCullTest(seed, isoLevelBias);
            }

            if (!node.geometryTested && node.cullState === CullState.OUTSIDE && !node.isVisible) {
                continue;
            }

            const maxLevel = this.getMaxLevel();
            const shouldSubdivide = node.shouldSubdivide(cameraPos, maxLevel);
            const shouldCollapse = node.shouldCollapse(cameraPos);

            if (shouldSubdivide && !node.children && node.geometryTested && node.hasGeometry) {
                node.createChildren();
                for (const child of node.children!) {
                    if (child.lastOcclusionFrame !== frameId) {
                        const childAABB = { min: child.bounds.min, max: child.bounds.max };
                        child.lastOcclusionResult = this.frustum.testAABBWithPlanetOcclusion(childAABB, cameraPos);
                        child.lastOcclusionFrame = frameId;
                    }
                    if (child.lastOcclusionResult !== FrustumResult.OUTSIDE) {
                        this.queueNodeGeneration(child, true);
                    }
                }
            } else if (shouldCollapse && node.children) {
                const lodConfig = this.configManager.getLODLevel(node.level);
                const safeCollapseDistance = lodConfig ? lodConfig.fadeOutEnd + 50 : node.distanceToCamera;
                if (node.distanceToCamera > safeCollapseDistance) {
                    node.destroyChildren(this.gl);
                }
            }

            if (node.children) {
                for (const child of node.children) {
                    stack.push(child);
                }
            }
        }
    }

    private queueNodeGeneration(
        node: OctreeNode, 
        isVisible: boolean, 
        isInitial: boolean = false, 
        isPredictive: boolean = false
    ): void {
        if (
            this.pendingNodes.has(node) ||
            node.state === NodeState.GENERATING ||
            node.state === NodeState.READY ||
            node.state === NodeState.CULLED
        ) {
            return;
        }
        
        const isEssential = this.isEssentialDependency(node) || isInitial;
        
        if (isEssential) {
            if (this.essentialQueue.length >= this.MAX_ESSENTIAL_QUEUE_SIZE) {
                return;
            }
        } else {
            if (this.generationQueue.length >= this.MAX_LOCAL_QUEUE_SIZE && 
                !isVisible && !isPredictive) {
                return;
            }
        }
        
        const priority = this.calculatePriority(node, isVisible, isInitial, isPredictive);
        const request: GenerationRequest = {
            node,
            priority,
            isVisible,
            timestamp: performance.now(),
            isInitial,
            isPredictive,
            isEssentialDependency: isEssential,
            dependencyLevel: 0
        };
        
        if (isEssential) {
            let insertIndex = 0;
            for (let i = 0; i < this.essentialQueue.length; i++) {
                const existing = this.essentialQueue[i];
                if (request.node.level < existing.node.level) {
                    insertIndex = i;
                    break;
                } else if (request.node.level === existing.node.level && request.priority > existing.priority) {
                    insertIndex = i;
                    break;
                }
                insertIndex = i + 1;
            }
            this.essentialQueue.splice(insertIndex, 0, request);
        } else {
            let insertIndex = 0;
            for (let i = 0; i < this.generationQueue.length; i++) {
                const existing = this.generationQueue[i];
                
                if (request.isVisible && !existing.isVisible) {
                    insertIndex = i;
                    break;
                }
                
                if (request.isVisible && existing.isVisible) {
                    if (request.node.level > existing.node.level) {
                        insertIndex = i;
                        break;
                    } else if (request.node.level === existing.node.level && request.priority > existing.priority) {
                        insertIndex = i;
                        break;
                    }
                } else if (request.priority > existing.priority) {
                    insertIndex = i;
                    break;
                }
                insertIndex = i + 1;
            }
            this.generationQueue.splice(insertIndex, 0, request);
        }
        
        this.pendingNodes.add(node);
        if (!isPredictive) {
            node.state = NodeState.GENERATING;
            node.generationStartTime = performance.now();
        }
    }

    private calculatePriority(node: OctreeNode, isVisible: boolean, isInitial: boolean = false, isPredictive: boolean = false): number {
        let basePriority = 0;
        const maxLevel = this.getMaxLevel();
        
        if (isInitial) {
            if (node.level === 0) {
                basePriority = 1000000;
            } else if (node.level === 1) {
                basePriority = 500000;
            } else {
                basePriority = 100000;
            }
        } else if (node.level === 0) {
            basePriority = 100000;
        } else if (isVisible) {
            basePriority = 10000 * Math.pow(10, node.level);
        } else if (isPredictive) {
            basePriority = 5000 * Math.pow(10, node.level);
        } else {
            basePriority = 1000 + node.level * 100;
        }
        
        const distancePenalty = Math.min(node.distanceToCamera * node.distanceToCamera * 0.2, 20000);
        return basePriority - distancePenalty;
    }

    private processGenerationQueue(): void {
        let maxGenerationsPerFrame: number;
        
        if (!this.essentialNodesComplete) {
            maxGenerationsPerFrame = 4;
        } else if (!this.initialGenerationComplete) {
            maxGenerationsPerFrame = 3;
        } else {
            maxGenerationsPerFrame = 3;
        }
        
        const workerStats = this.workerManager.getStats();
        const availableWorkers = workerStats.availableWorkers;
        maxGenerationsPerFrame = Math.min(maxGenerationsPerFrame, availableWorkers);
        
        const essentialSlots = Math.min(Math.ceil(maxGenerationsPerFrame * 0.4), this.essentialQueue.length);
        const regularSlots = maxGenerationsPerFrame - essentialSlots;
        
        let generationsStarted = 0;
        
        let essentialProcessed = 0;
        while (this.essentialQueue.length > 0 && 
               essentialProcessed < essentialSlots &&
               availableWorkers > 0) {
            const request = this.essentialQueue.shift()!;
            this.generateNodeChunk(request.node, request.isVisible);
            essentialProcessed++;
            generationsStarted++;
        }
        
        let regularProcessed = 0;
        while (this.generationQueue.length > 0 &&
               regularProcessed < regularSlots &&
               availableWorkers > 0) {
            const request = this.generationQueue.shift()!;
            this.generateNodeChunk(request.node, request.isVisible);
            regularProcessed++;
            generationsStarted++;
        }
    }

    private async generateNodeChunk(node: OctreeNode, isVisible: boolean): Promise<void> {
        const cfg = this.configManager.getConfig();
        const seed = this.configManager.getSeed();
        const perLevelBias = this.configManager.getIsoLevelBias();
        
        try {
            const voxelGridSize = node.voxelGridSize;
            const nominalSize = node.bounds.size;
            const [originX, originY, originZ] = node.getWorldOrigin();
            const maxLevel = this.getMaxLevel();
            const finestLevel = maxLevel;
            const levelDifference = finestLevel - node.level;
            const actualBias = levelDifference * perLevelBias;
            
            const nodeId = `${originX}_${originY}_${originZ}_${node.level}`;
            
            const res = await this.workerManager.generateChunk(
                originX,
                originY,
                originZ,
                nominalSize,
                voxelGridSize,
                node.level,
                actualBias,
                seed,
                isVisible,
                nodeId
            );
            
            if (res.type === 'complete' && res.volume) {
                const lodConfig = this.configManager.getLODLevel(node.level);
                if (!lodConfig) {
                    return;
                }
                
                const chunk = new Chunk(
                    0, 0, 0,
                    nominalSize,
                    node.level,
                    this.getLODColor(node.level),
                    lodConfig.fadeInEnd,
                    lodConfig.fadeOutStart,
                    node.level,
                    lodConfig.fadeInStart,
                    lodConfig.fadeInEnd,
                    lodConfig.fadeOutStart,
                    lodConfig.fadeOutEnd
                );
                
                chunk.state = "generating";
                this.processChunkVolume(chunk, res.volume, voxelGridSize, node);
                node.chunk = chunk;
                node.state = NodeState.READY;
                this.completedNodes.add(node);
            }
        } catch (e) {
            if (e instanceof Error && !e.message.includes('evicted') && !e.message.includes('expired')) {
                console.warn('Chunk generation failed:', e.message);
            }
            node.state = NodeState.EMPTY;
            node.updateGeometryStatus(false);
        } finally {
            this.pendingNodes.delete(node);
        }
    }

    private processChunkVolume(chunk: Chunk, volume: Uint8Array, voxelGridSize: number, node: OctreeNode): void {
        try {
            this.marchingCubes.set_volume(volume, voxelGridSize+1, voxelGridSize+1, voxelGridSize+1);
            const meshResult = this.marchingCubes.marching_cubes_indexed_pos(0.5);
            const mesh = Reflect.get(meshResult, "vertices") as Float32Array;
            const indices = Reflect.get(meshResult, "indices") as Uint32Array;
            
            if (!mesh || mesh.length === 0 || !indices || indices.length === 0) {
                chunk.isEmpty = true;
                chunk.state = "ready";
                node.updateGeometryStatus(false);
                return;
            }
            
            const [ox, oy, oz] = node.getWorldOrigin();
            const vsize = node.voxelSize;
            const worldPos = new Float32Array(mesh.length);
            
            for(let i = 0; i < mesh.length; i += 3) {
                worldPos[i] = (mesh[i] - 0.5) * vsize + ox;
                worldPos[i+1] = (mesh[i+1] - 0.5) * vsize + oy;
                worldPos[i+2] = (mesh[i+2] - 0.5) * vsize + oz;
            }
            
            const seed = this.configManager.getSeed();
            const perLevelBias = this.configManager.getIsoLevelBias();
            const maxLevel = this.getMaxLevel();
            const finestLevel = maxLevel;
            const levelDifference = finestLevel - node.level;
            const actualBias = levelDifference * perLevelBias;
            const normals = computeNormalsFieldGradientJS(worldPos, seed, actualBias, 0.5 * vsize);
            
            const materialWeights: MaterialWeights[] = [];
            const numVertices = worldPos.length / 3;
            for (let i = 0; i < numVertices; i++) {
                const vertexIndex = i * 3;
                const worldPosition: [number, number, number] = [
                    worldPos[vertexIndex],
                    worldPos[vertexIndex + 1],
                    worldPos[vertexIndex + 2]
                ];
                const worldNormal: [number, number, number] = [
                    normals[vertexIndex],
                    normals[vertexIndex + 1],
                    normals[vertexIndex + 2]
                ];
                const weights = MaterialSystem.calculateMaterialWeights(worldPosition, worldNormal);
                materialWeights.push(weights);
            }
            
            const inter = new Float32Array((worldPos.length / 3) * 6);
            for(let i = 0, j = 0; i < worldPos.length; i += 3, j += 6) {
                inter[j] = worldPos[i];
                inter[j+1] = worldPos[i+1];
                inter[j+2] = worldPos[i+2];
                inter[j+3] = normals[i];
                inter[j+4] = normals[i+1];
                inter[j+5] = normals[i+2];
            }
            
            chunk.meshVertices = inter;
            chunk.meshIndices = indices;
            chunk.setMaterialData(materialWeights);
            chunk.isEmpty = false;
            chunk.state = "ready";
            chunk.setupGL(this.gl, this.shader);
            node.updateGeometryStatus(true);
            
        } catch(e) {
            chunk.state = "error";
            node.updateGeometryStatus(false);
        }
    }

    private getLODColor(level: number): [number, number, number] {
        const colors: [number, number, number][] = [
            [1.0, 1.0, 1.0],
            [1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0],
            [0.0, 1.0, 0.0],
            [1.0, 0.0, 1.0],
            [1.0, 1.0, 0.0],
            [0.0, 1.0, 1.0],
            [1.0, 0.5, 0.0],
            [0.5, 0.0, 1.0],
            [0.5, 1.0, 0.0],
        ];
        const maxLevel = this.getMaxLevel();
        const finestLevel = maxLevel;
        const invertedLevel = finestLevel - level;
        return colors[invertedLevel % colors.length];
    }

    public renderAll(
        gl: WebGL2RenderingContext,
        shader: any,
        projView: mat4,
        eye: [number, number, number],
        uniforms: any
    ): void {
        const renderableNodes = this.root.getAllRenderableNodes();
        this.frameStats.chunksRendered = 0;

        const cameraPos = vec3.fromValues(eye[0], eye[1], eye[2]);
        
        let visibleRenderableNodes;
        if (this.essentialNodesComplete) {
            visibleRenderableNodes = renderableNodes.filter(node => {
                const aabb = {
                    min: node.bounds.min,
                    max: node.bounds.max
                };
                return this.frustum.testAABBWithPlanetOcclusion(aabb, cameraPos) !== FrustumResult.OUTSIDE;
            });
        } else {
            visibleRenderableNodes = renderableNodes;
        }

        visibleRenderableNodes.sort((a, b) => a.level - b.level);
        const maxLevel = this.getMaxLevel();
        const perLevelZBias = this.configManager.getZBiasFactor();

        for (const node of visibleRenderableNodes) {
            if (node.chunk && node.chunk.state === "ready" && !node.chunk.isEmpty) {
                this.frameStats.chunksRendered++;
                const extendedUniforms = {
                    ...uniforms,
                    fade_alpha: 1.0,
                    max_lod_level: maxLevel,
                    z_bias_factor: perLevelZBias
                };
                node.chunk.render(gl, shader, projView, eye, extendedUniforms);
            }
        }
    }

    public getStats() {
        const totalNodes = this.countNodes(this.root);
        const leafNodes = this.root.getAllLeafNodes();
        const visibleNodes = this.root.getAllVisibleLeafNodes();
        const maxLevel = this.getMaxLevel();
        const levelCounts = new Array(maxLevel + 1).fill(0);
        for (const node of leafNodes) {
            if (node.chunk && !node.chunk.isEmpty) {
                levelCounts[node.level]++;
            }
        }
        
        const predictiveRequests = this.generationQueue.filter(r => r.isPredictive).length;
        
        return {
            totalNodes,
            leafNodes: leafNodes.length,
            visibleNodes: visibleNodes.length,
            pendingGeneration: this.pendingNodes.size,
            queueLength: this.generationQueue.length,
            essentialQueueLength: this.essentialQueue.length,
            predictiveRequests,
            levelCounts,
            frameStats: this.frameStats,
            workers: this.workerManager.getStats(),
            memoryUsageMB: this.frameStats.memoryUsage / (1024 * 1024),
            rootInitialized: this.rootInitialized,
            initialGenerationComplete: this.initialGenerationComplete,
            essentialNodesComplete: this.essentialNodesComplete,
            initializationPhase: this.initializationPhase,
            completedNodes: this.completedNodes.size,
            rootState: this.root.state,
            rootHasGeometry: this.root.hasGeometry,
            maxLevel: maxLevel,
            cameraSpeed: Math.sqrt(
                this.cameraVelocity[0] * this.cameraVelocity[0] +
                this.cameraVelocity[1] * this.cameraVelocity[1] +
                this.cameraVelocity[2] * this.cameraVelocity[2]
            )
        };
    }

    private countNodes(node: OctreeNode): number {
        let count = 1;
        if (node.children) {
            for (const child of node.children) {
                count += this.countNodes(child);
            }
        }
        return count;
    }

    public cleanup(): void {
        this.workerManager.terminate();
        this.root.cleanup(this.gl);
        this.generationQueue = [];
        this.essentialQueue = [];
        this.pendingNodes.clear();
        this.completedNodes.clear();
    }

    public onConfigChanged(): void {}
}