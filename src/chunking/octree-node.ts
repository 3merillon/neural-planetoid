import { vec3 } from "gl-matrix";
import { Chunk } from "./chunk";
import { densityAtSeeded } from "./density";
import { ChunkConfigManager } from "./chunk-config";

export enum NodeState {
    EMPTY = "empty",
    GENERATING = "generating",
    READY = "ready",
    SUBDIVIDED = "subdivided",
    CULLED = "culled"
}

export enum CullState {
    UNKNOWN = "unknown",
    INSIDE = "inside",
    OUTSIDE = "outside",
    INTERSECTS = "intersects",
    GEOMETRY_TESTED = "geometry_tested"
}

export interface NodeBounds {
    center: vec3;
    size: number;
    min: vec3;
    max: vec3;
    mcMin: vec3;
    mcMax: vec3;
    mcSize: number;
}

export class OctreeNode {
    public state: NodeState = NodeState.EMPTY;
    public cullState: CullState = CullState.UNKNOWN;
    public chunk: Chunk | null = null;
    public children: OctreeNode[] | null = null;
    public parent: OctreeNode | null = null;
    public bounds: NodeBounds;
    public level: number;
    public priority: number = 0;
    public distanceToCamera: number = Infinity;
    public isVisible: boolean = false;
    public lastVisibilityCheck: number = 0;
    public fadeInStartTime: number = 0;
    public shouldFadeIn: boolean = false;

    public hasGeometry: boolean = false;
    public geometryTested: boolean = false;

    public voxelGridSize: number;
    public voxelSize: number;

    public generationStartTime: number = 0;
    public lastAccessTime: number = 0;

    public lastOcclusionResult: number = -1;
    public lastOcclusionFrame: number = -1;

    private subdivisionDistance: number;

    constructor(
        center: vec3,
        size: number,
        level: number,
        voxelGridSize: number = 32,
        parent: OctreeNode | null = null
    ) {
        this.level = level;
        this.parent = parent;
        this.voxelGridSize = voxelGridSize;
        this.voxelSize = size / voxelGridSize;

        const mcSize = size + this.voxelSize;

        this.bounds = {
            center: vec3.clone(center),
            size,
            min: vec3.fromValues(center[0] - size/2, center[1] - size/2, center[2] - size/2),
            max: vec3.fromValues(center[0] + size/2, center[1] + size/2, center[2] + size/2),
            mcMin: vec3.fromValues(center[0] - mcSize/2, center[1] - mcSize/2, center[2] - mcSize/2),
            mcMax: vec3.fromValues(center[0] + mcSize/2, center[1] + mcSize/2, center[2] + mcSize/2),
            mcSize
        };

        const lodDistanceFactor = ChunkConfigManager.getInstance().getLodDistanceFactor();
        this.subdivisionDistance = this.bounds.size * lodDistanceFactor;

        this.lastAccessTime = performance.now();
    }

    public getWorldOrigin(): [number, number, number] {
        return [this.bounds.min[0], this.bounds.min[1], this.bounds.min[2]];
    }

    public getChunkCoordinates(): [number, number, number] {
        return [
            Math.floor(this.bounds.min[0] / this.bounds.size),
            Math.floor(this.bounds.min[1] / this.bounds.size),
            Math.floor(this.bounds.min[2] / this.bounds.size)
        ];
    }

    public updateDistanceToCamera(cameraPos: vec3): void {
        this.distanceToCamera = vec3.distance(this.bounds.center, cameraPos);
        this.lastAccessTime = performance.now();
    }

    public getAllRenderableNodes(): OctreeNode[] {
        const renderableNodes: OctreeNode[] = [];
        this.collectRenderableNodes(renderableNodes);
        return renderableNodes;
    }

    private collectRenderableNodes(result: OctreeNode[]): void {
        if (!this.isVisible) return;

        if (this.shouldRender() && this.chunk && this.chunk.state === "ready" && !this.chunk.isEmpty) {
            result.push(this);
        }
        if (this.children) {
            for (const child of this.children) {
                child.collectRenderableNodes(result);
            }
        }
    }

    public shouldSubdivide(cameraPos: vec3, maxLevel: number): boolean {
        if (this.level >= maxLevel) return false;
        if (!this.hasConfirmedGeometry()) return false;
        const lodDistanceFactor = ChunkConfigManager.getInstance().getLodDistanceFactor();
        this.subdivisionDistance = this.bounds.size * lodDistanceFactor;
        return this.distanceToCamera < this.subdivisionDistance;
    }

    public shouldCollapse(cameraPos: vec3): boolean {
        if (!this.children || this.level === 0) return false;
        const lodDistanceFactor = ChunkConfigManager.getInstance().getLodDistanceFactor();
        this.subdivisionDistance = this.bounds.size * lodDistanceFactor;
        return this.distanceToCamera >= this.subdivisionDistance;
    }

    public hasConfirmedGeometry(): boolean {
        if (this.geometryTested) {
            return this.hasGeometry;
        }
        if (this.parent) {
            return this.parent.hasConfirmedGeometry();
        }
        return this.level === 0;
    }

    public allChildrenReady(): boolean {
        if (!this.children || this.children.length === 0) return false;
        for (const child of this.children) {
            if (!child) continue;
            const isReady = child.state === NodeState.READY;
            const hasTestedGeometry = child.geometryTested === true;
            const hasValidGeometry = child.hasGeometry === true;
            const hasReadyChildren = child.allChildrenReady();
            if (!isReady || !hasTestedGeometry || (!hasValidGeometry && !hasReadyChildren)) {
                return false;
            }
        }
        return true;
    }

    public shouldRender(): boolean {
        if (this.geometryTested === false && this.hasGeometry === false) {
            return false;
        }
        if (this.hasGeometry === true) {
            return true;
        }
        const hasChildrenNotReady = this.children !== null && this.allChildrenReady() === false;
        return hasChildrenNotReady;
    }

    public createChildren(): void {
        if (this.children) return;
        this.children = [];
        const childSize = this.bounds.size / 2;
        const childVoxelGridSize = Math.max(8, this.voxelGridSize);
        for (let x = 0; x < 2; x++) {
            for (let y = 0; y < 2; y++) {
                for (let z = 0; z < 2; z++) {
                    const childCenter = vec3.fromValues(
                        this.bounds.center[0] + (x - 0.5) * childSize,
                        this.bounds.center[1] + (y - 0.5) * childSize,
                        this.bounds.center[2] + (z - 0.5) * childSize
                    );
                    const child = new OctreeNode(
                        childCenter,
                        childSize,
                        this.level + 1,
                        childVoxelGridSize,
                        this
                    );
                    this.children.push(child);
                }
            }
        }
        this.state = NodeState.SUBDIVIDED;
    }

    public destroyChildren(gl: WebGL2RenderingContext): void {
        if (!this.children) return;

        const stack: OctreeNode[] = [...this.children];
        this.children = null;

        while (stack.length > 0) {
            const node = stack.pop()!;

            if (node.chunk) {
                node.chunk.cleanup(gl);
                node.chunk = null;
            }
            if (node.children) {
                stack.push(...node.children);
                node.children = null;
            }
            node.state = NodeState.EMPTY;
            node.geometryTested = false;
            node.hasGeometry = false;
        }

        if (this.chunk) {
            this.state = NodeState.READY;
        } else {
            this.state = NodeState.EMPTY;
        }
    }

    public getAllLeafNodes(): OctreeNode[] {
        if (!this.children) {
            return [this];
        }
        const leaves: OctreeNode[] = [];
        for (const child of this.children) {
            leaves.push(...child.getAllLeafNodes());
        }
        return leaves;
    }

    public getAllVisibleRenderNodes(): OctreeNode[] {
        if (this.isVisible !== true) return [];
        if (this.shouldRender() === true) {
            return [this];
        }
        if (this.children) {
            const renderNodes: OctreeNode[] = [];
            for (const child of this.children) {
                renderNodes.push(...child.getAllVisibleRenderNodes());
            }
            return renderNodes;
        }
        return [];
    }

    public getAllVisibleLeafNodes(): OctreeNode[] {
        if (this.isVisible !== true) return [];
        if (!this.children) {
            const isReady = this.state === NodeState.READY;
            const hasGeom = this.hasGeometry === true;
            const notTested = this.geometryTested === false;
            return (isReady && (hasGeom || notTested)) ? [this] : [];
        }
        const leaves: OctreeNode[] = [];
        for (const child of this.children) {
            leaves.push(...child.getAllVisibleLeafNodes());
        }
        return leaves;
    }

    public cleanup(gl: WebGL2RenderingContext): void {
        const stack: OctreeNode[] = [this];
        while (stack.length > 0) {
            const node = stack.pop()!;
            if (node.chunk) {
                node.chunk.cleanup(gl);
                node.chunk = null;
            }
            if (node.children) {
                stack.push(...node.children);
                node.children = null;
            }
            node.state = NodeState.EMPTY;
            node.geometryTested = false;
            node.hasGeometry = false;
        }
    }

    public performCullTest(seed: number, perLevelBias: number): CullState {
        if (this.cullState !== CullState.UNKNOWN) {
            return this.cullState;
        }
        const estimatedMaxLevel = 7;
        const finestLevel = estimatedMaxLevel;
        const levelDifference = finestLevel - this.level;
        const actualBias = levelDifference * perLevelBias;
        const samples: vec3[] = [
            this.bounds.center,
            this.bounds.mcMin,
            this.bounds.mcMax,
            vec3.fromValues(this.bounds.mcMin[0], this.bounds.mcMax[1], this.bounds.mcMin[2]),
            vec3.fromValues(this.bounds.mcMax[0], this.bounds.mcMin[1], this.bounds.mcMax[2])
        ];
        let positiveCount = 0;
        let negativeCount = 0;
        for (const sample of samples) {
            const density = densityAtSeeded(sample[0], sample[1], sample[2], seed, actualBias);
            if (density > 5.0) positiveCount++;
            else if (density < -5.0) negativeCount++;
        }
        if (positiveCount === samples.length) {
            this.cullState = CullState.INSIDE;
        } else if (negativeCount === samples.length) {
            this.cullState = CullState.OUTSIDE;
        } else {
            this.cullState = CullState.INTERSECTS;
        }
        return this.cullState;
    }

    public updateGeometryStatus(hasGeometry: boolean): void {
        this.hasGeometry = hasGeometry;
        this.geometryTested = true;
        this.cullState = CullState.GEOMETRY_TESTED;
        if (this.parent) {
            if (hasGeometry) {
                this.parent.hasGeometry = true;
            } else {
                if (this.parent.children && this.parent.children.every(child => child.geometryTested && !child.hasGeometry)) {
                    this.parent.hasGeometry = false;
                    this.parent.geometryTested = true;
                    this.parent.cullState = CullState.GEOMETRY_TESTED;
                }
            }
        }
    }

    public forceCullRetest(): void {
        this.cullState = CullState.UNKNOWN;
        this.geometryTested = false;
        this.hasGeometry = false;
        if (this.children) {
            for (const child of this.children) {
                child.forceCullRetest();
            }
        }
    }

    public getMemoryFootprint(): number {
        let size = 0;
        if (this.chunk) {
            size += this.chunk.getMemoryFootprint();
        }
        if (this.children) {
            for (const child of this.children) {
                size += child.getMemoryFootprint();
            }
        }
        return size;
    }

    public getSubdivisionInfo(): { subdivisionDistance: number } {
        return {
            subdivisionDistance: this.subdivisionDistance
        };
    }
}