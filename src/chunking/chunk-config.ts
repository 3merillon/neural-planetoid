export interface WorldGenerationConfig {
    seed: number;
    voxelResolution: number;
    numLODLevels: number;
    rootSizeMultiplier: number;
    zBiasFactor: number;
    isoLevelBias: number;
    fadeOverlapFactor: number;
    maxChunks: number;
    maxWorkers: number;
    lodDistanceFactor: number;
}

export interface LODLevel {
    level: number;
    worldSize: number;
    color: [number, number, number];
    minDistance: number;
    maxDistance: number;
    isoOffset: number;
    gridAlignment: number;
    fadeNear: number;
    fadeFar: number;
    fadeInStart: number;
    fadeInEnd: number;
    fadeOutStart: number;
    fadeOutEnd: number;
    zBias: number;
}

export interface ChunkConfig {
    voxelGridSize: number;
    lodLevels: LODLevel[];
    zBiasFactor: number;
    fadeOverlapFactor: number;
    maxChunks: number;
    maxWorkers: number;
    lodDistanceFactor: number;
}

export class ChunkConfigManager {
    private static instance: ChunkConfigManager;
    private config: ChunkConfig;
    private genConfig: WorldGenerationConfig;
    private seed: number = 1337;
    private isoLevelBias: number = 0.0;
    private actualRootOctreeSize: number = 640;

    private constructor() {
        this.genConfig = {
            seed: 1337,
            voxelResolution: 32,
            numLODLevels: 5,
            rootSizeMultiplier: 8,
            zBiasFactor: 0.000003,
            isoLevelBias: 0.0,
            fadeOverlapFactor: 0.35,
            maxChunks: 1024,
            maxWorkers: navigator.hardwareConcurrency || 4,
            lodDistanceFactor: 4.0
        };
        this.config = {
            voxelGridSize: this.genConfig.voxelResolution,
            lodLevels: [],
            zBiasFactor: this.genConfig.zBiasFactor,
            fadeOverlapFactor: this.genConfig.fadeOverlapFactor,
            maxChunks: this.genConfig.maxChunks,
            maxWorkers: this.genConfig.maxWorkers,
            lodDistanceFactor: this.genConfig.lodDistanceFactor
        };
        this.generateLODLevels();
    }

    public static getInstance(): ChunkConfigManager {
        if (!ChunkConfigManager.instance) {
            ChunkConfigManager.instance = new ChunkConfigManager();
        }
        return ChunkConfigManager.instance;
    }

    public static createWorld(config: WorldGenerationConfig): ChunkConfigManager {
        const instance = ChunkConfigManager.getInstance();
        instance.setWorldConfig(config);
        return instance;
    }

    public setWorldConfig(worldConfig: WorldGenerationConfig): void {
        this.genConfig = { ...worldConfig };
        this.config.voxelGridSize = worldConfig.voxelResolution;
        this.config.zBiasFactor = worldConfig.zBiasFactor;
        this.config.fadeOverlapFactor = worldConfig.fadeOverlapFactor;
        this.config.maxChunks = worldConfig.maxChunks;
        this.config.maxWorkers = worldConfig.maxWorkers;
        this.config.lodDistanceFactor = worldConfig.lodDistanceFactor;
        this.seed = worldConfig.seed;
        this.isoLevelBias = worldConfig.isoLevelBias;
        this.generateLODLevels();
    }

    public calculateRootOctreeSize(): number {
        const planetRadius = 80;
        const multiplier = this.genConfig.rootSizeMultiplier;
        const rootSize = planetRadius * multiplier;
        return rootSize;
    }

    public setRootOctreeSize(rootSize: number): void {
        this.actualRootOctreeSize = rootSize;
        this.updateOverlappingFadeDistances();
    }

    public getRootOctreeSize(): number {
        return this.actualRootOctreeSize;
    }

    private generateLODLevels(): void {
        const colors: [number, number, number][] = [
            [1.0, 1.0, 1.0], // White
            [1.0, 0.0, 0.0], // Red
            [0.0, 0.0, 1.0], // Blue
            [0.0, 1.0, 0.0], // Green
            [1.0, 0.0, 1.0], // Purple
            [1.0, 1.0, 0.0], // Yellow
            [0.0, 1.0, 1.0], // Cyan
            [1.0, 0.5, 0.0], // Orange
            [0.5, 0.0, 1.0], // Violet
            [0.5, 1.0, 0.0], // Lime
        ];

        this.config.lodLevels = [];

        for (let level = 0; level < this.genConfig.numLODLevels; level++) {
            const rootSize = this.calculateRootOctreeSize();
            const worldSize = rootSize / Math.pow(2, level);
            const gridAlignment = worldSize;
            const isoOffset = 0.0;
            const zBias = 0.0;

            const finestLevel = this.genConfig.numLODLevels - 1;
            const invertedLevel = finestLevel - level;
            const color = colors[invertedLevel % colors.length];

            const lodLevel: LODLevel = {
                level,
                worldSize,
                color,
                minDistance: 0,
                maxDistance: Number.POSITIVE_INFINITY,
                isoOffset,
                gridAlignment,
                fadeNear: 0,
                fadeFar: 0,
                fadeInStart: 0,
                fadeInEnd: 0,
                fadeOutStart: 0,
                fadeOutEnd: 0,
                zBias
            };

            this.config.lodLevels.push(lodLevel);
        }

        this.updateOverlappingFadeDistances();
    }

    private updateOverlappingFadeDistances(): void {
        const lodLevels = this.config.lodLevels;
        if (lodLevels.length === 0) return;

        const rootOctreeSize = this.actualRootOctreeSize;
        const overlapFactor = this.config.fadeOverlapFactor;
        const maxLevel = this.genConfig.numLODLevels - 1;
        const lodDistanceFactor = this.config.lodDistanceFactor;

        for (let i = 0; i < lodLevels.length; i++) {
            const currentLOD = lodLevels[i];
            const nodeSize = rootOctreeSize / Math.pow(2, i);
            const subdivisionDistance = nodeSize * lodDistanceFactor;
            const overlapZone = subdivisionDistance * overlapFactor;

            if (i === maxLevel) {
                currentLOD.fadeInStart = 0;
                currentLOD.fadeInEnd = 0;
                if (i > 0) {
                    const prevNodeSize = rootOctreeSize / Math.pow(2, i - 1);
                    const prevSubdivisionDistance = prevNodeSize * lodDistanceFactor;
                    currentLOD.fadeOutStart = subdivisionDistance + overlapZone;
                    currentLOD.fadeOutEnd = Math.max(currentLOD.fadeOutStart + 1, prevSubdivisionDistance);
                } else {
                    currentLOD.fadeOutStart = subdivisionDistance * 4.0;
                    currentLOD.fadeOutEnd = subdivisionDistance * 8.0;
                }
            } else if (i === 0) {
                if (maxLevel > 0) {
                    const nextNodeSize = rootOctreeSize / Math.pow(2, i + 1);
                    const nextSubdivisionDistance = nextNodeSize * lodDistanceFactor;
                    const nextOverlapZone = nextSubdivisionDistance * overlapFactor;
                    currentLOD.fadeInStart = nextSubdivisionDistance;
                    currentLOD.fadeInEnd = nextSubdivisionDistance + nextOverlapZone - 1;
                } else {
                    currentLOD.fadeInStart = 0;
                    currentLOD.fadeInEnd = 0;
                }
                currentLOD.fadeOutStart = subdivisionDistance * 10.0;
                currentLOD.fadeOutEnd = subdivisionDistance * 20.0;
            } else {
                const nextNodeSize = rootOctreeSize / Math.pow(2, i + 1);
                const nextSubdivisionDistance = nextNodeSize * lodDistanceFactor;
                const nextOverlapZone = nextSubdivisionDistance * overlapFactor;

                currentLOD.fadeInStart = nextSubdivisionDistance;
                currentLOD.fadeInEnd = (nextSubdivisionDistance + nextOverlapZone) * 0.9;

                const prevNodeSize = rootOctreeSize / Math.pow(2, i - 1);
                const prevSubdivisionDistance = prevNodeSize * lodDistanceFactor;
                currentLOD.fadeOutStart = subdivisionDistance + overlapZone;
                currentLOD.fadeOutEnd = Math.max(currentLOD.fadeOutStart + 1, prevSubdivisionDistance);
            }

            currentLOD.fadeNear = currentLOD.fadeInEnd;
            currentLOD.fadeFar = currentLOD.fadeOutStart;
        }
    }

    public setZBiasFactor(factor: number): void {
        this.config.zBiasFactor = factor;
    }
    public getZBiasFactor(): number {
        return this.config.zBiasFactor;
    }
    public setFadeOverlapFactor(factor: number): void {
        this.config.fadeOverlapFactor = Math.max(0.1, Math.min(0.8, factor));
        this.updateOverlappingFadeDistances();
    }
    public getFadeOverlapFactor(): number {
        return this.config.fadeOverlapFactor;
    }
    public setLodDistanceFactor(factor: number): void {
        this.config.lodDistanceFactor = Math.max(2.01, factor);
        this.generateLODLevels();
    }
    public getLodDistanceFactor(): number {
        return this.config.lodDistanceFactor;
    }
    public setSeed(seed: number) {
        this.seed = seed;
    }
    public getSeed(): number {
        return this.seed;
    }
    public setIsoLevelBias(bias: number) {
        this.isoLevelBias = bias;
    }
    public getIsoLevelBias(): number {
        return this.isoLevelBias;
    }
    public getConfig(): ChunkConfig {
        return {
            ...this.config,
            lodLevels: this.config.lodLevels.map(lod => ({ ...lod }))
        };
    }
    public getWorldConfig(): WorldGenerationConfig {
        return { ...this.genConfig };
    }
    public getLODLevel(level: number): LODLevel | undefined {
        return this.config.lodLevels.find(lod => lod.level === level);
    }
}