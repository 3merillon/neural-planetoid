import { Chunk } from "./chunk";

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

    constructor(maxSize: number = 512) {
        this.maxSize = maxSize;
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
        // Priority calculation:
        // - LOD0 gets highest base priority (1000)
        // - LOD1 gets medium base priority (500)
        // - LOD2 gets lowest base priority (100)
        // - Closer chunks get higher priority (subtract distance)
        // - In-use chunks get bonus (+500)
        
        let basePriority = 0;
        switch (chunk.lodLevel) {
            case 0: basePriority = 1000; break; // LOD0 highest priority
            case 1: basePriority = 500; break;  // LOD1 medium priority
            case 2: basePriority = 100; break;  // LOD2 lowest priority
            default: basePriority = 50; break;
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
                //console.warn("Could not evict any chunks - all are in use or high priority");
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
            // Clean up GL resources
            const chunk = entry.chunk;
            if (chunk.vao) gl.deleteVertexArray(chunk.vao);
            if (chunk.vbo) gl.deleteBuffer(chunk.vbo);
            if (chunk.ibo) gl.deleteBuffer(chunk.ibo);
            
            this.pool.delete(key);
        }
    }

    private evictLowestPriorityChunk(): boolean {
        let lowestPriorityKey: string | null = null;
        let lowestPriority = Infinity;
        let oldestTime = Infinity;
        
        // Find the chunk with lowest priority that's not in use
        for (const [key, entry] of this.pool) {
            if (!entry.inUse) {
                // Prefer lower priority, then older chunks
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
            
            // Note: GL cleanup should be handled by caller
            this.pool.delete(lowestPriorityKey);
            
            /*console.log(`Evicted LOD${chunk.lodLevel} chunk (${chunk.chunkX}, ${chunk.chunkY}, ${chunk.chunkZ}) ` +
                       `priority: ${entry.priority.toFixed(1)}, distance: ${entry.distanceFromCamera.toFixed(1)}`);*/
            return true;
        }
        
        return false; // No chunks available for eviction
    }

    public getStats() {
        let inUse = 0;
        let cached = 0;
        let lodCounts = [0, 0, 0, 0, 0]; // Updated for 5 LOD levels
        let priorityStats = { min: Infinity, max: -Infinity, avg: 0 };
        let totalPriority = 0;
        
        for (const entry of this.pool.values()) {
            if (entry.inUse) {
                inUse++;
            } else {
                cached++;
            }
            
            // Count by LOD level
            if (entry.chunk.lodLevel >= 0 && entry.chunk.lodLevel < 5) {
                lodCounts[entry.chunk.lodLevel]++;
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
            maxSize: this.maxSize,
            lodCounts,
            priorityStats
        };
    }

    public cleanup(gl: WebGL2RenderingContext): void {
        for (const entry of this.pool.values()) {
            const chunk = entry.chunk;
            if (chunk.vao) gl.deleteVertexArray(chunk.vao);
            if (chunk.vbo) gl.deleteBuffer(chunk.vbo);
            if (chunk.ibo) gl.deleteBuffer(chunk.ibo);
        }
        this.pool.clear();
    }

    // Debug method to get priority information
    public getPriorityInfo(): Array<{key: string, lod: number, priority: number, distance: number, inUse: boolean}> {
        const info = [];
        for (const [key, entry] of this.pool) {
            info.push({
                key,
                lod: entry.chunk.lodLevel,
                priority: entry.priority,
                distance: entry.distanceFromCamera,
                inUse: entry.inUse
            });
        }
        return info.sort((a, b) => b.priority - a.priority); // Sort by priority descending
    }
}