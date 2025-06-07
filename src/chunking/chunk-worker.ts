import { densityAtSeeded } from './density';

export interface ChunkWorkMessage {
    type: 'generate';
    originX: number;
    originY: number;
    originZ: number;
    worldSize: number;
    voxelGridSize: number;
    workerId: number;
    lodLevel: number;
    isoLevelBias: number;
    seed: number;
}

export interface ChunkWorkResult {
    type: 'complete' | 'error';
    originX?: number;
    originY?: number;
    originZ?: number;
    volume?: Uint8Array;
    voxelGridSize?: number;
    worldSize?: number;
    workerId: number;
    lodLevel?: number;
    error?: string;
}

// Vite will bundle this as a module worker!
self.onmessage = function(e: MessageEvent<ChunkWorkMessage>) {
    const { type, originX, originY, originZ, worldSize, voxelGridSize, workerId, lodLevel, isoLevelBias, seed } = e.data;
    if (type === 'generate') {
        try {
            const N = voxelGridSize;
            const volume = new Uint8Array((N + 1) * (N + 1) * (N + 1));
            const ox = originX;
            const oy = originY;
            const oz = originZ;
            const voxelSize = worldSize / voxelGridSize;
            for (let z = 0; z <= N; ++z) {
                for (let y = 0; y <= N; ++y) {
                    for (let x = 0; x <= N; ++x) {
                        const worldX = ox + x * voxelSize;
                        const worldY = oy + y * voxelSize;
                        const worldZ = oz + z * voxelSize;
                        const val = densityAtSeeded(worldX, worldY, worldZ, seed, isoLevelBias);
                        const v = Math.max(0, Math.min(255, Math.round((val + 16) * 8)));
                        volume[z * (N + 1) * (N + 1) + y * (N + 1) + x] = v;
                    }
                }
            }
            self.postMessage({
                type: 'complete',
                originX,
                originY,
                originZ,
                volume,
                voxelGridSize,
                worldSize,
                workerId,
                lodLevel
            });
        } catch (error: any) {
            self.postMessage({
                type: 'error',
                originX,
                originY,
                originZ,
                error: error.message,
                workerId,
                lodLevel
            });
        }
    }
};