import { Chunk } from "./chunk";
//import { densityAtRaw } from "./density";
import { MarchingCubes } from "../marching-cubes-wasm/marching_cubes";
import { computeNormalsFieldGradientJS } from "./field-gradient";
import { mat4 } from "gl-matrix";
import { ChunkConfigManager, type LODLevel } from "./chunk-config";
import { WorkerManager } from "./worker-manager";
import { ChunkPool } from "./chunk-pool";

function chunkKey(x: number, y: number, z: number, worldSize: number): string {
    return `${x},${y},${z},${worldSize}`;
}

export class ChunkManager {
    private configManager: ChunkConfigManager;
    private workerManager: WorkerManager;
    private chunkPool: ChunkPool;
    public chunks: Map<string, Chunk> = new Map();
    private pendingChunks: Set<string> = new Set();
    private lastCameraPosition: [number, number, number] = [0, 0, 0];

    constructor(
        public marchingCubes: MarchingCubes,
        public gl: WebGL2RenderingContext,
        public shader: any,
        public uniforms: any
    ) {
        this.configManager = ChunkConfigManager.getInstance();
        const config = this.configManager.getConfig();
        
        this.workerManager = new WorkerManager(config.maxWorkers);
        this.chunkPool = new ChunkPool(config.maxChunks);
    }

    worldToChunk(x: number, y: number, z: number, worldSize: number): [number, number, number] {
        return [
            Math.floor(x / worldSize),
            Math.floor(y / worldSize),
            Math.floor(z / worldSize)
        ];
    }

    alignToGrid(coord: number, alignment: number): number {
        return Math.floor(coord / alignment) * alignment;
    }

    update(cameraPos: [number, number, number]) {
        const config = this.configManager.getConfig();
        
        // Update camera position in pool for priority calculations
        this.chunkPool.setCameraPosition(cameraPos);
        this.lastCameraPosition = [...cameraPos];
        
        // Mark all chunks as not in use initially
        for (const [key, chunk] of this.chunks) {
            this.chunkPool.markNotInUse(chunk.chunkX, chunk.chunkY, chunk.chunkZ, chunk.worldSize);
        }
        
        let needed = new Set<string>();
        
        // Process LOD levels in priority order: LOD0 first, then LOD1, then LOD2
        const sortedLODs = [...config.lodLevels].sort((a, b) => a.level - b.level);
        
        for (const lodLevel of sortedLODs) {
            this.updateLODLevel(cameraPos, lodLevel, needed);
        }
        
        // Remove chunks that are no longer needed from active set
        for (let key of this.chunks.keys()) {
            if (!needed.has(key)) {
                const chunk = this.chunks.get(key)!;
                this.chunkPool.markNotInUse(chunk.chunkX, chunk.chunkY, chunk.chunkZ, chunk.worldSize);
                this.chunks.delete(key);
            }
        }
    }

    private updateLODLevel(cameraPos: [number, number, number], lodLevel: LODLevel, needed: Set<string>) {
        // Convert camera position to this LOD's chunk coordinates
        const [cx, cy, cz] = this.worldToChunk(...cameraPos, lodLevel.worldSize);
        
        // Align camera chunk position to LOD grid
        const alignedCx = Math.floor(cx * lodLevel.worldSize / lodLevel.gridAlignment) * (lodLevel.gridAlignment / lodLevel.worldSize);
        const alignedCy = Math.floor(cy * lodLevel.worldSize / lodLevel.gridAlignment) * (lodLevel.gridAlignment / lodLevel.worldSize);
        const alignedCz = Math.floor(cz * lodLevel.worldSize / lodLevel.gridAlignment) * (lodLevel.gridAlignment / lodLevel.worldSize);
        
        // Generate chunks in priority order: closest first
        const radius = lodLevel.maxDistance;
        const chunksToGenerate = [];
        
        for (let dz = -radius; dz <= radius; ++dz) {
            for (let dy = -radius; dy <= radius; ++dy) {
                for (let dx = -radius; dx <= radius; ++dx) {
                    // Calculate distance from camera
                    const distance = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
                    
                    // Generate all chunks up to this LOD's max distance
                    if (distance > lodLevel.maxDistance) {
                        continue;
                    }
                    
                    // Calculate chunk coordinates
                    let kx = alignedCx + dx * (lodLevel.gridAlignment / lodLevel.worldSize);
                    let ky = alignedCy + dy * (lodLevel.gridAlignment / lodLevel.worldSize);
                    let kz = alignedCz + dz * (lodLevel.gridAlignment / lodLevel.worldSize);
                    
                    // Ensure proper grid alignment
                    kx = Math.round(kx);
                    ky = Math.round(ky);
                    kz = Math.round(kz);
                    
                    chunksToGenerate.push({ kx, ky, kz, distance });
                }
            }
        }
        
        // Sort chunks by distance (closest first) for priority generation
        chunksToGenerate.sort((a, b) => a.distance - b.distance);
        
        // Process chunks in priority order
        for (const { kx, ky, kz } of chunksToGenerate) {
            let key = chunkKey(kx, ky, kz, lodLevel.worldSize);
            needed.add(key);
            
            // Check if chunk exists in pool first
            let chunk = this.chunkPool.getChunk(kx, ky, kz, lodLevel.worldSize);
            
            if (chunk) {
                // Chunk exists in pool, add to active chunks
                this.chunks.set(key, chunk);
                this.chunkPool.markInUse(kx, ky, kz, lodLevel.worldSize);
            } else if (!this.chunks.has(key) && !this.pendingChunks.has(key)) {
                // Need to generate new chunk
                this.pendingChunks.add(key);
                this.generateChunkAsync(kx, ky, kz, lodLevel);
            }
        }
    }

    private async generateChunkAsync(
        chunkX: number, 
        chunkY: number, 
        chunkZ: number, 
        lodLevel: LODLevel
    ): Promise<void> {
        const config = this.configManager.getConfig();
        const seed = this.configManager.getSeed();
        const isoLevelBias = this.configManager.getIsoLevelBias() * lodLevel.level;
        const zBiasFactor = this.configManager.getZBiasFactor();
        
        try {
            const result = await this.workerManager.generateChunk(
                chunkX, 
                chunkY, 
                chunkZ, 
                lodLevel.worldSize, 
                config.voxelGridSize,
                lodLevel.level,
                isoLevelBias, // pass per-LOD bias
                seed
            );
            
            if (result.type === 'complete' && result.volume) {
                const chunk = new Chunk(
                    chunkX, 
                    chunkY, 
                    chunkZ, 
                    lodLevel.worldSize,
                    lodLevel.level,
                    lodLevel.color,
                    lodLevel.fadeNear,
                    lodLevel.fadeFar,
                    lodLevel.zBias
                );
                chunk.state = "generating";
                
                // Process the volume data with marching cubes
                this.processChunkVolume(chunk, result.volume, result.voxelGridSize!, lodLevel);
                
                // Add to pool and active chunks if still needed
                this.chunkPool.addChunk(chunk);
                const key = chunkKey(chunkX, chunkY, chunkZ, lodLevel.worldSize);
                
                // Only add to active chunks if still needed
                if (this.pendingChunks.has(key)) {
                    this.chunks.set(key, chunk);
                    this.chunkPool.markInUse(chunkX, chunkY, chunkZ, lodLevel.worldSize);
                }
            }
        } catch (error) {
            //console.error(`Failed to generate LOD${lodLevel.level} chunk (${chunkX}, ${chunkY}, ${chunkZ}):`, error);
        } finally {
            const key = chunkKey(chunkX, chunkY, chunkZ, lodLevel.worldSize);
            this.pendingChunks.delete(key);
        }
    }

    private processChunkVolume(
        chunk: Chunk, 
        volume: Uint8Array, 
        voxelGridSize: number, 
        lodLevel: LODLevel
    ): void {
        try {
            this.marchingCubes.set_volume(volume, voxelGridSize + 1, voxelGridSize + 1, voxelGridSize + 1);
            const mesh = this.marchingCubes.marching_cubes_indexed_pos(0.5);
            const positions = Reflect.get(mesh, "vertices") as Float32Array;
            const indices = Reflect.get(mesh, "indices") as Uint32Array;
            
            const [ox, oy, oz] = chunk.getWorldOrigin();
            const voxelSize = lodLevel.worldSize / voxelGridSize;
            
            // Convert to world coordinates
            const worldPositions = new Float32Array(positions.length);
            for (let i = 0; i < positions.length; i += 3) {
                worldPositions[i] = positions[i] * voxelSize + ox;
                worldPositions[i + 1] = positions[i + 1] * voxelSize + oy;
                worldPositions[i + 2] = positions[i + 2] * voxelSize + oz;
            }
            
            // Compute normals
            const seed = this.configManager.getSeed();
            const isoLevelBias = this.configManager.getIsoLevelBias() * lodLevel.level;
            const normals = computeNormalsFieldGradientJS(
                worldPositions,
                seed,
                isoLevelBias,
                0.5 * voxelSize
            );
            
            // Interleave positions and normals
            const interleaved = new Float32Array((worldPositions.length / 3) * 6);
            for (let i = 0, j = 0; i < worldPositions.length; i += 3, j += 6) {
                interleaved[j] = worldPositions[i];
                interleaved[j + 1] = worldPositions[i + 1];
                interleaved[j + 2] = worldPositions[i + 2];
                interleaved[j + 3] = normals[i];
                interleaved[j + 4] = normals[i + 1];
                interleaved[j + 5] = normals[i + 2];
            }
            
            chunk.meshVertices = interleaved;
            chunk.meshIndices = indices;
            chunk.state = "ready";
            chunk.setupGL(this.gl, this.shader);
        } catch (e) {
            chunk.state = "error";
            //console.error("Chunk processing error:", e);
        }
    }

    renderAll(gl: WebGL2RenderingContext, shader: any, projView: mat4, eye: [number,number,number], uniforms: any) {
        const config = this.configManager.getConfig();
        
        // Add z-bias factor to uniforms
        const extendedUniforms = {
            ...uniforms,
            enable_dithering: config.enableDithering,
            max_lod_level: config.lodLevels.length - 1,
            z_bias_factor: config.zBiasFactor
        };
        
        // Render in reverse order (highest LOD number first)
        const chunksByLOD: Chunk[][] = Array(config.lodLevels.length).fill(null).map(() => []);
        
        for (let chunk of this.chunks.values()) {
            if (chunk.state === "ready" && chunk.lodLevel >= 0 && chunk.lodLevel < config.lodLevels.length) {
                chunksByLOD[chunk.lodLevel].push(chunk);
            }
        }
        
        // Render from highest LOD to lowest (back to front)
        for (let lod = config.lodLevels.length - 1; lod >= 0; lod--) {
            for (let chunk of chunksByLOD[lod]) {
                chunk.render(gl, shader, projView, eye, extendedUniforms);
            }
        }
    }

    getStats() {
        const config = this.configManager.getConfig();
        const workerStats = this.workerManager.getStats();
        const poolStats = this.chunkPool.getStats();
        
        let ready = 0, gen = 0, err = 0;
        let lodCounts = [0, 0, 0, 0, 0]; // Count per LOD level (0-4)
        
        for (let c of this.chunks.values()) {
            if (c.state === "ready") {
                ready++;
                if (c.lodLevel >= 0 && c.lodLevel < 5) {
                    lodCounts[c.lodLevel]++;
                }
            } else if (c.state === "generating") gen++;
            else if (c.state === "error") err++;
        }
        
        return {
            ready,
            gen,
            err,
            total: this.chunks.size,
            pending: this.pendingChunks.size,
            lodCounts,
            poolLodCounts: poolStats.lodCounts,
            voxelGridSize: config.voxelGridSize,
            worldSize: config.worldSize,
            voxelSize: config.worldSize / config.voxelGridSize,
            workers: workerStats,
            pool: poolStats,
            ditheringEnabled: config.enableDithering
        };
    }

    cleanup(): void {
        this.workerManager.terminate();
        this.chunkPool.cleanup(this.gl);
        this.chunks.clear();
        this.pendingChunks.clear();
    }

    // Debug method to get detailed priority info
    public getPoolPriorityInfo() {
        return this.chunkPool.getPriorityInfo();
    }
}
