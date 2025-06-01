export interface ChunkRequest {
    chunkX: number;
    chunkY: number;
    chunkZ: number;
    worldSize: number;
    lodLevel: number;
    priority: number;
    isVisible: boolean;
    distanceToCamera: number;
    timestamp: number;
}

export class ChunkPriorityQueue {
    private visibleQueue: ChunkRequest[] = [];
    private backgroundQueue: ChunkRequest[] = [];
    private requestMap: Map<string, ChunkRequest> = new Map();
    private maxLODLevel: number = 4; // Will be updated dynamically

    private getKey(chunkX: number, chunkY: number, chunkZ: number, worldSize: number): string {
        return `${chunkX},${chunkY},${chunkZ},${worldSize}`;
    }

    public setMaxLODLevel(maxLevel: number): void {
        this.maxLODLevel = maxLevel;
    }

    public addRequest(request: ChunkRequest): void {
        const key = this.getKey(request.chunkX, request.chunkY, request.chunkZ, request.worldSize);
        
        // Remove existing request if present
        this.removeRequest(request.chunkX, request.chunkY, request.chunkZ, request.worldSize);
        
        // Add to appropriate queue
        if (request.isVisible) {
            this.insertSorted(this.visibleQueue, request);
        } else {
            this.insertSorted(this.backgroundQueue, request);
        }
        
        this.requestMap.set(key, request);
    }

    public removeRequest(chunkX: number, chunkY: number, chunkZ: number, worldSize: number): boolean {
        const key = this.getKey(chunkX, chunkY, chunkZ, worldSize);
        const request = this.requestMap.get(key);
        
        if (!request) return false;
        
        // Remove from appropriate queue
        const queue = request.isVisible ? this.visibleQueue : this.backgroundQueue;
        const index = queue.findIndex(r => 
            r.chunkX === chunkX && r.chunkY === chunkY && r.chunkZ === chunkZ && r.worldSize === worldSize
        );
        
        if (index >= 0) {
            queue.splice(index, 1);
        }
        
        this.requestMap.delete(key);
        return true;
    }

    public getNextRequest(): ChunkRequest | null {
        // Always prioritize visible chunks
        if (this.visibleQueue.length > 0) {
            const request = this.visibleQueue.shift()!;
            const key = this.getKey(request.chunkX, request.chunkY, request.chunkZ, request.worldSize);
            this.requestMap.delete(key);
            return request;
        }
        
        // Fall back to background chunks
        if (this.backgroundQueue.length > 0) {
            const request = this.backgroundQueue.shift()!;
            const key = this.getKey(request.chunkX, request.chunkY, request.chunkZ, request.worldSize);
            this.requestMap.delete(key);
            return request;
        }
        
        return null;
    }

    public promoteToVisible(chunkX: number, chunkY: number, chunkZ: number, worldSize: number): boolean {
        const key = this.getKey(chunkX, chunkY, chunkZ, worldSize);
        const request = this.requestMap.get(key);
        
        if (!request || request.isVisible) return false;
        
        // Remove from background queue
        const bgIndex = this.backgroundQueue.findIndex(r => 
            r.chunkX === chunkX && r.chunkY === chunkY && r.chunkZ === chunkZ && r.worldSize === worldSize
        );
        
        if (bgIndex >= 0) {
            this.backgroundQueue.splice(bgIndex, 1);
            
            // Update request and add to visible queue
            request.isVisible = true;
            request.priority = this.calculateVisiblePriority(request.lodLevel, request.distanceToCamera);
            request.timestamp = performance.now();
            
            this.insertSorted(this.visibleQueue, request);
            return true;
        }
        
        return false;
    }

    private insertSorted(queue: ChunkRequest[], request: ChunkRequest): void {
        let insertIndex = 0;
        
        // Find insertion point (higher priority first)
        for (let i = 0; i < queue.length; i++) {
            if (queue[i].priority < request.priority) {
                insertIndex = i;
                break;
            }
            insertIndex = i + 1;
        }
        
        queue.splice(insertIndex, 0, request);
    }

    private calculateVisiblePriority(lodLevel: number, distance: number): number {
        // Dynamic priority calculation based on LOD level
        // L0 gets highest priority, each subsequent level gets exponentially lower priority
        const maxPriority = 100000;
        const basePriority = lodLevel === 0 ? maxPriority : Math.max(1000, maxPriority / Math.pow(2, lodLevel));
        
        // Subtract distance penalty (closer = higher priority)
        const distancePenalty = Math.min(distance * 10, 5000);
        
        return basePriority - distancePenalty;
    }

    public getStats() {
        // Dynamic LOD counting based on current max level
        const visibleByLOD = new Array(this.maxLODLevel + 1).fill(0);
        const backgroundByLOD = new Array(this.maxLODLevel + 1).fill(0);
        
        for (const request of this.visibleQueue) {
            if (request.lodLevel >= 0 && request.lodLevel <= this.maxLODLevel) {
                visibleByLOD[request.lodLevel]++;
            }
        }
        
        for (const request of this.backgroundQueue) {
            if (request.lodLevel >= 0 && request.lodLevel <= this.maxLODLevel) {
                backgroundByLOD[request.lodLevel]++;
            }
        }
        
        return {
            visibleCount: this.visibleQueue.length,
            backgroundCount: this.backgroundQueue.length,
            totalCount: this.visibleQueue.length + this.backgroundQueue.length,
            visibleByLOD,
            backgroundByLOD
        };
    }

    public clear(): void {
        this.visibleQueue = [];
        this.backgroundQueue = [];
        this.requestMap.clear();
    }

    public isEmpty(): boolean {
        return this.visibleQueue.length === 0 && this.backgroundQueue.length === 0;
    }
}