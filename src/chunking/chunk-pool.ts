import { Chunk } from "./chunk";
import { ChunkConfigManager } from "./chunk-config";

export interface ChunkPoolEntry {
    chunk: Chunk;
    lastUsed: number;
    inUse: boolean;
    priority: number;
    distanceFromCamera: number;
}

export class ChunkPool {
    private pool: Map<string, ChunkPoolEntry> = new Map();
    private maxSize: number;
    private cameraPosition: [number, number, number] = [0, 0, 0];
    private configManager: ChunkConfigManager;

    constructor(maxSize: number = 512) {
        this.maxSize = maxSize;
        this.configManager = ChunkConfigManager.getInstance();
    }

    private chunkKey(x: number, y: number, z: number, worldSize: number): string {
        return `${x},${y},${z},${worldSize}`;
    }

    public setCameraPosition(pos: [number, number, number]): void {
        this.cameraPosition = pos;
        // Update distances for all chunks
        for (const entry of this.pool.values()) {
            entry.distanceFromCamera = this.calculateChunkDistance(entry.chunk);
            entry.priority = this.calculatePriority(entry.chunk, entry.distanceFromCamera);
        }
    }

    private calculateChunkDistance(chunk: Chunk): number {
        const [ox, oy, oz] = chunk.getWorldOrigin();
        const centerX = ox + chunk.worldSize / 2;
        const centerY = oy + chunk.worldSize / 2;
        const centerZ = oz + chunk.worldSize / 2;
        
        const dx = centerX - this.cameraPosition[0];
        const dy = centerY - this.cameraPosition[1];
        const dz = centerZ - this.cameraPosition[2];
        
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    private calculatePriority(chunk: Chunk, distance: number): number {
        const config = this.configManager.getConfig();
        const numLODs = config.lodLevels.length;
        
        // Empty chunks get lower priority
        if (chunk.isEmpty) {
            return 10; // Very low priority for empty chunks
        }
        
        // Calculate base priority: L0 gets highest, each level gets exponentially lower
        const maxBasePriority = 1000;
        let basePriority = 0;
        
        if (chunk.lodLevel === 0) {
            basePriority = maxBasePriority; // L0 always gets highest priority
        } else if (chunk.lodLevel < numLODs) {
            // Exponential decay for higher LODs
            basePriority = Math.max(50, maxBasePriority / Math.pow(2, chunk.lodLevel));
        } else {
            basePriority = 50; // Fallback for unexpected LOD levels
        }
        
        // Distance penalty (closer = higher priority)
        const distancePenalty = Math.min(distance * 2, 400); // Cap penalty at 400
        
        // In-use bonus
        const entry = this.pool.get(this.chunkKey(chunk.chunkX, chunk.chunkY, chunk.chunkZ, chunk.worldSize));
        const inUseBonus = (entry && entry.inUse) ? 500 : 0;
        
        return basePriority - distancePenalty + inUseBonus;
    }

    public getChunk(x: number, y: number, z: number, worldSize: number): Chunk | null {
        const key = this.chunkKey(x, y, z, worldSize);
        const entry = this.pool.get(key);
        
        if (entry) {
            entry.lastUsed = performance.now();
            entry.inUse = true;
            entry.distanceFromCamera = this.calculateChunkDistance(entry.chunk);
            entry.priority = this.calculatePriority(entry.chunk, entry.distanceFromCamera);
            return entry.chunk;
        }
        
        return null;
    }

    public addChunk(chunk: Chunk): void {
        const key = this.chunkKey(chunk.chunkX, chunk.chunkY, chunk.chunkZ, chunk.worldSize);
        
        // If chunk already exists, update it
        if (this.pool.has(key)) {
            const entry = this.pool.get(key)!;
            entry.chunk = chunk;
            entry.lastUsed = performance.now();
            entry.inUse = true;
            entry.distanceFromCamera = this.calculateChunkDistance(chunk);
            entry.priority = this.calculatePriority(chunk, entry.distanceFromCamera);
            return;
        }
        
        // If pool is full, make room using priority-based eviction
        while (this.pool.size >= this.maxSize) {
            if (!this.evictLowestPriorityChunk()) {
                break;
            }
        }
        
        const distance = this.calculateChunkDistance(chunk);
        const priority = this.calculatePriority(chunk, distance);
        
        this.pool.set(key, {
            chunk,
            lastUsed: performance.now(),
            inUse: true,
            priority,
            distanceFromCamera: distance
        });
    }

    public markInUse(x: number, y: number, z: number, worldSize: number = 32): void {
        const key = this.chunkKey(x, y, z, worldSize);
        const entry = this.pool.get(key);
        if (entry) {
            entry.inUse = true;
            entry.lastUsed = performance.now();
            entry.priority = this.calculatePriority(entry.chunk, entry.distanceFromCamera);
        }
    }

    public markNotInUse(x: number, y: number, z: number, worldSize: number = 32): void {
        const key = this.chunkKey(x, y, z, worldSize);
        const entry = this.pool.get(key);
        if (entry) {
            entry.inUse = false;
            entry.priority = this.calculatePriority(entry.chunk, entry.distanceFromCamera);
        }
    }

    public removeChunk(x: number, y: number, z: number, worldSize: number, gl: WebGL2RenderingContext): void {
        const key = this.chunkKey(x, y, z, worldSize);
        const entry = this.pool.get(key);
        
        if (entry) {
            // Clean up GL resources (only for non-empty chunks)
            const chunk = entry.chunk;
            if (!chunk.isEmpty) {
                if (chunk.vao) gl.deleteVertexArray(chunk.vao);
                if (chunk.vbo) gl.deleteBuffer(chunk.vbo);
                if (chunk.ibo) gl.deleteBuffer(chunk.ibo);
                if (chunk.materialVbo) gl.deleteBuffer(chunk.materialVbo);
            }
            
            this.pool.delete(key);
        }
    }

    private evictLowestPriorityChunk(): boolean {
        let lowestPriorityKey: string | null = null;
        let lowestPriority = Infinity;
        let oldestTime = Infinity;
        
        // Prefer evicting empty chunks first
        for (const [key, entry] of this.pool) {
            if (!entry.inUse) {
                // Empty chunks are always good candidates for eviction
                if (entry.chunk.isEmpty) {
                    lowestPriorityKey = key;
                    break;
                }
                
                // Otherwise use normal priority logic
                if (entry.priority < lowestPriority || 
                    (entry.priority === lowestPriority && entry.lastUsed < oldestTime)) {
                    lowestPriority = entry.priority;
                    oldestTime = entry.lastUsed;
                    lowestPriorityKey = key;
                }
            }
        }
        
        if (lowestPriorityKey) {
            const entry = this.pool.get(lowestPriorityKey)!;
            const chunk = entry.chunk;
            
            // Clean up GL resources (empty chunks have none)
            if (!chunk.isEmpty) {
                // Note: GL cleanup should be handled by caller for non-empty chunks
            }
            
            this.pool.delete(lowestPriorityKey);
            return true;
        }
        
        return false; // No chunks available for eviction
    }

    public getStats() {
        const config = this.configManager.getConfig();
        const numLODs = config.lodLevels.length;
        
        let inUse = 0;
        let cached = 0;
        let empty = 0;
        let lodCounts = new Array(numLODs).fill(0);
        let priorityStats = { min: Infinity, max: -Infinity, avg: 0 };
        let totalPriority = 0;
        let memoryUsage = 0;
        
        for (const entry of this.pool.values()) {
            if (entry.inUse) {
                inUse++;
            } else {
                cached++;
            }
            
            if (entry.chunk.isEmpty) {
                empty++;
            } else {
                // Count by LOD level (only non-empty chunks)
                if (entry.chunk.lodLevel >= 0 && entry.chunk.lodLevel < numLODs) {
                    lodCounts[entry.chunk.lodLevel]++;
                }
                
                // Add to memory usage
                memoryUsage += entry.chunk.getMemoryFootprint();
            }
            
            // Priority stats
            priorityStats.min = Math.min(priorityStats.min, entry.priority);
            priorityStats.max = Math.max(priorityStats.max, entry.priority);
            totalPriority += entry.priority;
        }
        
        priorityStats.avg = this.pool.size > 0 ? totalPriority / this.pool.size : 0;
        
        return {
            total: this.pool.size,
            inUse,
            cached,
            empty,
            maxSize: this.maxSize,
            lodCounts,
            priorityStats,
            memoryUsageMB: memoryUsage / (1024 * 1024)
        };
    }

    public cleanup(gl: WebGL2RenderingContext): void {
        for (const entry of this.pool.values()) {
            const chunk = entry.chunk;
            if (!chunk.isEmpty) {
                if (chunk.vao) gl.deleteVertexArray(chunk.vao);
                if (chunk.vbo) gl.deleteBuffer(chunk.vbo);
                if (chunk.ibo) gl.deleteBuffer(chunk.ibo);
                if (chunk.materialVbo) gl.deleteBuffer(chunk.materialVbo);
            }
        }
        this.pool.clear();
    }

    // Debug method to get priority information
    public getPriorityInfo(): Array<{key: string, lod: number, priority: number, distance: number, inUse: boolean, isEmpty: boolean}> {
        const info = [];
        for (const [key, entry] of this.pool) {
            info.push({
                key,
                lod: entry.chunk.lodLevel,
                priority: entry.priority,
                distance: entry.distanceFromCamera,
                inUse: entry.inUse,
                isEmpty: entry.chunk.isEmpty
            });
        }
        return info.sort((a, b) => b.priority - a.priority); // Sort by priority descending
    }
}