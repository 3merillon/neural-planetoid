export interface LODLevel {
    level: number;
    worldSize: number;
    color: [number, number, number]; // RGB color for debugging
    minDistance: number; // In chunk units (not used for exclusion anymore)
    maxDistance: number; // In chunk units (generation radius)
    isoOffset: number; // Bias for shrinking isosurface (negative = shrink)
    gridAlignment: number; // Alignment boundary
    fadeNear: number; // Distance where fade starts (world units)
    fadeFar: number;  // Distance where fade ends (world units)
    zBias: number;
}

export interface ChunkConfig {
    voxelGridSize: number;
    worldSize: number;
    viewRadius: number;
    maxChunks: number;
    maxWorkers: number;
    lodLevels: LODLevel[];
    enableDithering: boolean;
    zBiasFactor: number;
}

export interface WorldLODConfig {
    chunksAroundViewer: number;  // How many chunks in each direction (4 = 9x9x9)
    voxelResolution: number;     // Resolution inside each chunk (32 = 32x32x32 grid)
    baseChunkSize: number;       // World size of L0 chunks (32 = 32x32x32 world units)
    numLODLevels: number;        // Number of LOD levels (5 = L0,L1,L2,L3,L4)
}

export class ChunkConfigManager {
    private static instance: ChunkConfigManager;
    private config: ChunkConfig;
    private worldConfig: WorldLODConfig;
    private seed: number = 1337;
    private isoLevelBias: number = 0.0;

    private constructor() {
        // Default world configuration
        this.worldConfig = {
            chunksAroundViewer: 4,  // 9x9x9 chunks (4 in each direction from center)
            voxelResolution: 32,    // 32x32x32 voxel grid per chunk
            baseChunkSize: 32,      // 32x32x32 world units for L0 chunks
            numLODLevels: 5         // L0, L1, L2, L3, L4
        };

        this.config = {
            voxelGridSize: this.worldConfig.voxelResolution,
            worldSize: this.worldConfig.baseChunkSize,
            viewRadius: this.worldConfig.chunksAroundViewer,
            maxChunks: 512,
            maxWorkers: navigator.hardwareConcurrency || 4,
            enableDithering: true,
            zBiasFactor: 0.000003,
            lodLevels: []
        };
        
        // Generate LOD levels based on world configuration
        this.generateLODLevels();
    }

    public static getInstance(): ChunkConfigManager {
        if (!ChunkConfigManager.instance) {
            ChunkConfigManager.instance = new ChunkConfigManager();
        }
        return ChunkConfigManager.instance;
    }

    public static createWorld(config: WorldLODConfig): ChunkConfigManager {
        const instance = ChunkConfigManager.getInstance();
        instance.setWorldConfig(config);
        return instance;
    }

    public setWorldConfig(worldConfig: WorldLODConfig): void {
        this.worldConfig = { ...worldConfig };
        
        // Update basic config
        this.config.voxelGridSize = worldConfig.voxelResolution;
        this.config.worldSize = worldConfig.baseChunkSize;
        this.config.viewRadius = worldConfig.chunksAroundViewer;
        
        // Regenerate LOD levels
        this.generateLODLevels();
        
        /*console.log(`World LOD Configuration:
        Chunks Around Viewer: ${worldConfig.chunksAroundViewer} (${worldConfig.chunksAroundViewer * 2 + 1}³ grid)
        Voxel Resolution: ${worldConfig.voxelResolution}³ per chunk
        Base Chunk Size: ${worldConfig.baseChunkSize}³ world units
        Number of LOD Levels: ${worldConfig.numLODLevels} (L0-L${worldConfig.numLODLevels - 1})`);*/
    }

    private generateLODLevels(): void {
        const colors: [number, number, number][] = [
            [1.0, 1.0, 1.0], // L0: White
            [1.0, 0.0, 0.0], // L1: Red
            [0.0, 0.0, 1.0], // L2: Blue
            [0.0, 1.0, 0.0], // L3: Green
            [1.0, 0.0, 1.0], // L4: Purple
            [1.0, 1.0, 0.0], // L5: Yellow
            [0.0, 1.0, 1.0], // L6: Cyan
            [1.0, 0.5, 0.0], // L7: Orange
            [0.5, 0.0, 1.0], // L8: Violet
            [0.5, 1.0, 0.0], // L9: Lime
        ];

        this.config.lodLevels = [];

        for (let level = 0; level < this.worldConfig.numLODLevels; level++) {
            const worldSize = this.worldConfig.baseChunkSize * Math.pow(2, level);
            const gridAlignment = worldSize;
            const isoOffset = level === 0 ? 0.0 : -0.1 * level; // Subtle bias progression
            const zBias = level;
            
            const lodLevel: LODLevel = {
                level: level,
                worldSize: worldSize,
                color: colors[level % colors.length],
                minDistance: 0,
                maxDistance: this.worldConfig.chunksAroundViewer,
                isoOffset: isoOffset,
                gridAlignment: gridAlignment,
                fadeNear: 0, // Will be calculated
                fadeFar: 0,   // Will be calculated
                zBias: zBias
            };

            this.config.lodLevels.push(lodLevel);
        }

        // Calculate fade distances
        this.updateFadeDistances();
    }

    public setZBiasFactor(factor: number): void {
        this.config.zBiasFactor = factor;
        //console.log(`Set Z-bias factor to ${factor}`);
    }

    public getZBiasFactor(): number {
        return this.config.zBiasFactor;
    }

    public setSeed(seed: number) {
        this.seed = seed;
        // If you want to log or trigger something else, do it here.
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

    public setLODZBias(level: number, bias: number): void {
        const lod = this.config.lodLevels.find(l => l.level === level);
        if (lod) {
            lod.zBias = bias;
            //console.log(`Set LOD${level} z-bias to ${bias}`);
        }
    }

    public getLODZBias(level: number): number {
        const lod = this.config.lodLevels.find(l => l.level === level);
        return lod ? lod.zBias : 0;
    }

    private updateFadeDistances(): void {
        const lodLevels = this.config.lodLevels;
        
        if (lodLevels.length === 0) return;

        // Calculate fade distances for each LOD level
        for (let i = 0; i < lodLevels.length; i++) {
            const currentLOD = lodLevels[i];
            const maxWorldDist = currentLOD.maxDistance * currentLOD.worldSize;

            if (i === 0) {
                // L0: Start fade much later to allow L1 to fully fade in first
                currentLOD.fadeNear = maxWorldDist * 0.85;  // Start fade very late
                currentLOD.fadeFar = maxWorldDist * 0.95;   // Complete fade at edge
            } else {
                // Higher LODs: Fade in early, complete fade-in well before previous LOD starts fading
                const prevLOD = lodLevels[i - 1];
                const prevMaxWorldDist = prevLOD.maxDistance * prevLOD.worldSize;
                
                // L1 must be FULLY solid before L0 starts fading
                // L0 starts fading at prevMaxWorldDist * 0.85
                // So L1 must complete fade-in before that point
                const prevFadeStart = prevMaxWorldDist * 0.85;
                
                // L1 fade-in should complete at ~80% of where L0 starts fading
                const fadeInEnd = prevFadeStart * 0.8;
                const fadeInStart = fadeInEnd * 0.9;  // Short fade-in transition
                
                currentLOD.fadeNear = fadeInStart;
                
                // Fade out much later (or not at all for final LOD)
                if (i === lodLevels.length - 1) {
                    // Final LOD: fade out at very far distance
                    currentLOD.fadeFar = maxWorldDist * 0.9;
                } else {
                    // Middle LODs: fade out to make room for next LOD
                    currentLOD.fadeFar = maxWorldDist * 0.85;
                }
            }
        }

        // Log the fade configuration
        let fadeInfo = `Corrected fade distances for ${lodLevels.length} LOD levels:\n`;
        for (let i = 0; i < lodLevels.length; i++) {
            const lod = lodLevels[i];
            const maxRange = lod.maxDistance * lod.worldSize;
            
            if (i === 0) {
                fadeInfo += `LOD${i}: Solid 0-${lod.fadeNear.toFixed(0)}, Fade-out ${lod.fadeNear.toFixed(0)}-${lod.fadeFar.toFixed(0)} (range: 0-${maxRange})\n`;
            } else {
                const fadeInEnd = lod.fadeNear * 1.11;  // Small fade-in zone
                const fadeOutStart = lod.fadeFar;
                
                fadeInfo += `LOD${i}: Fade-in ${lod.fadeNear.toFixed(0)}-${fadeInEnd.toFixed(0)}, Solid ${fadeInEnd.toFixed(0)}-${fadeOutStart.toFixed(0)}, Fade-out ${fadeOutStart.toFixed(0)}+ (range: 0-${maxRange})\n`;
            }
        }
        //console.log(fadeInfo);
    }

    public getConfig(): ChunkConfig {
        return { 
            ...this.config, 
            lodLevels: this.config.lodLevels.map(lod => ({ ...lod }))
        };
    }

    public getWorldConfig(): WorldLODConfig {
        return { ...this.worldConfig };
    }

    public getLODLevel(level: number): LODLevel | undefined {
        return this.config.lodLevels.find(lod => lod.level === level);
    }

    public getLODLevelForDistance(distance: number): LODLevel | undefined {
        return this.config.lodLevels.find(lod => 
            distance >= lod.minDistance && distance < lod.maxDistance
        );
    }

    public setVoxelGridSize(size: number): void {
        this.worldConfig.voxelResolution = size;
        this.config.voxelGridSize = size;
    }

    public setWorldSize(size: number): void {
        this.worldConfig.baseChunkSize = size;
        this.config.worldSize = size;
        this.generateLODLevels();
    }

    public setViewRadius(radius: number): void {
        this.worldConfig.chunksAroundViewer = radius;
        this.config.viewRadius = radius;
        
        // Update all LOD levels to use the same chunk radius
        for (const lod of this.config.lodLevels) {
            lod.maxDistance = radius;
        }
        
        this.updateFadeDistances();
    }

    public setNumLODLevels(numLevels: number): void {
        this.worldConfig.numLODLevels = Math.max(1, Math.min(numLevels, 10)); // Clamp between 1-10
        this.generateLODLevels();
    }

    public setMaxChunks(max: number): void {
        this.config.maxChunks = max;
    }

    public setMaxWorkers(max: number): void {
        this.config.maxWorkers = Math.min(max, 8);
    }

    public getVoxelSize(): number {
        return this.config.worldSize / this.config.voxelGridSize;
    }

    public getMaxViewDistance(): number {
        return Math.max(...this.config.lodLevels.map(lod => lod.maxDistance));
    }

    public setLODBias(level: number, bias: number): void {
        const lod = this.config.lodLevels.find(l => l.level === level);
        if (lod) {
            lod.isoOffset = bias;
            //console.log(`Set LOD${level} bias to ${bias} (iso level: ${bias})`);
        }
    }

    public getLODBias(level: number): number {
        const lod = this.config.lodLevels.find(l => l.level === level);
        return lod ? lod.isoOffset : 0;
    }

    public setDitheringEnabled(enabled: boolean): void {
        this.config.enableDithering = enabled;
    }

    public isDitheringEnabled(): boolean {
        return this.config.enableDithering;
    }

    public setLODFadeDistances(level: number, fadeNear: number, fadeFar: number): void {
        const lod = this.config.lodLevels.find(l => l.level === level);
        if (lod) {
            lod.fadeNear = fadeNear;
            lod.fadeFar = fadeFar;
            //console.log(`Set LOD${level} fade: ${fadeNear.toFixed(1)} -> ${fadeFar.toFixed(1)}`);
        }
    }

    public getLODFadeDistances(level: number): { fadeNear: number, fadeFar: number } {
        const lod = this.config.lodLevels.find(l => l.level === level);
        return lod ? { fadeNear: lod.fadeNear, fadeFar: lod.fadeFar } : { fadeNear: 0, fadeFar: 0 };
    }

    public getRecommendedBias(): { [key: number]: number } {
        const biases: { [key: number]: number } = {};
        for (let i = 0; i < this.config.lodLevels.length; i++) {
            biases[i] = i === 0 ? 0.0 : -0.1 * i;
        }
        return biases;
    }

    public getFadeInfo(): string {
        return this.config.lodLevels.map(lod => 
            `LOD${lod.level}: ${lod.fadeNear.toFixed(0)}->${lod.fadeFar.toFixed(0)}`
        ).join(' | ');
    }

    public getGenerationInfo(): string {
        return this.config.lodLevels.map(lod => {
            const range = lod.maxDistance * lod.worldSize;
            return `LOD${lod.level}: ${range}`;
        }).join(' | ');
    }

    public getWorldInfo(): string {
        const wc = this.worldConfig;
        return `${wc.chunksAroundViewer * 2 + 1}³ chunks, ${wc.voxelResolution}³ voxels, ${wc.baseChunkSize}³ base size, ${wc.numLODLevels} LODs`;
    }
}