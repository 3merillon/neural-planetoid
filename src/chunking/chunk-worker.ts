export interface ChunkWorkMessage {
    type: 'generate';
    chunkX: number;
    chunkY: number;
    chunkZ: number;
    worldSize: number;
    voxelGridSize: number;
    workerId: number;
    lodLevel: number;
    isoLevelBias: number;
    seed: number;
}

export interface ChunkWorkResult {
    type: 'complete' | 'error';
    chunkX: number;
    chunkY: number;
    chunkZ: number;
    volume?: Uint8Array;
    voxelGridSize?: number;
    worldSize?: number;
    workerId: number;
    lodLevel?: number;
    error?: string;
}

// Worker script content with LOD support
const workerScript = `
const PLANET_RADIUS = 80;
const PLANET_CENTER = [0,0,0];
const PLANET_WARP = 55;
const PLANET_NOISE_OCTAVES = 6;
const PLANET_NOISE_FREQ = 0.03;
const PLANET_NOISE_AMP = 1.0;
const CAVE_FREQ = 0.05;
const CAVE_STRENGTH = 10.0;
const CAVE_WARP_FREQ = 0.013;
const CAVE_WARP_AMP = 32.0;
const SPHERE_DISTORT_FREQ = 0.06;
const SPHERE_DISTORT_AMP = 18.0;
const CRATER_FREQ = 0.01;
const CRATER_STRENGTH = 3.0;

function hash(x, y, z, seed) {
    let h = x * 374761393 + y * 668265263 + z * 2147483647 + seed * 2654435761;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) & 0x7fffffff) / 0x3fffffff - 1.0;
}
function valueNoise(x, y, z, freq, seed) {
    let ix = Math.floor(x * freq), iy = Math.floor(y * freq), iz = Math.floor(z * freq);
    let fx = x * freq - ix, fy = y * freq - iy, fz = z * freq - iz;
    let v000 = hash(ix, iy, iz, seed);
    let v100 = hash(ix+1, iy, iz, seed);
    let v010 = hash(ix, iy+1, iz, seed);
    let v110 = hash(ix+1, iy+1, iz, seed);
    let v001 = hash(ix, iy, iz+1, seed);
    let v101 = hash(ix+1, iy, iz+1, seed);
    let v011 = hash(ix, iy+1, iz+1, seed);
    let v111 = hash(ix+1, iy+1, iz+1, seed);
    function lerp(a, b, t) { return a + (b-a)*t; }
    let v00 = lerp(v000, v100, fx);
    let v01 = lerp(v001, v101, fx);
    let v10 = lerp(v010, v110, fx);
    let v11 = lerp(v011, v111, fx);
    let v0 = lerp(v00, v10, fy);
    let v1 = lerp(v01, v11, fy);
    return lerp(v0, v1, fz);
}
function densityAt(x, y, z, isoLevelBias, seed) {
    let cx = x - PLANET_CENTER[0];
    let cy = y - PLANET_CENTER[1];
    let cz = z - PLANET_CENTER[2];

    let sphereDistort = valueNoise(
        cx, cy, cz, SPHERE_DISTORT_FREQ, seed ^ 0xBEEF
    ) * SPHERE_DISTORT_AMP;

    let wx = cx + valueNoise(cx+1000, cy, cz, PLANET_NOISE_FREQ*0.33, seed ^ 125) * PLANET_WARP;
    let wy = cy + valueNoise(cx, cy+1000, cz, PLANET_NOISE_FREQ*0.33, seed ^ 126) * PLANET_WARP;
    let wz = cz + valueNoise(cx, cy, cz+1000, PLANET_NOISE_FREQ*0.33, seed ^ 127) * PLANET_WARP;

    let amp = PLANET_NOISE_AMP, freq = PLANET_NOISE_FREQ, sum = 0, norm = 0;
    for (let i = 0; i < PLANET_NOISE_OCTAVES; ++i) {
        sum += amp * valueNoise(wx, wy, wz, freq, seed ^ (1000 + i * 17));
        norm += amp;
        freq *= 2.03;
        amp *= 0.53;
    }
    let surfaceNoise = sum / norm * 21.0;

    let craterNoise = valueNoise(wx, wy, wz, CRATER_FREQ, seed ^ 0xC0DE);
    let crater = Math.max(0, craterNoise - 0.55) * -CRATER_STRENGTH;

    let dist = Math.sqrt(cx*cx + cy*cy + cz*cz) + sphereDistort + surfaceNoise + crater;

    let density = PLANET_RADIUS - dist;

    let caveWarpX = cx + valueNoise(cx, cy, cz, CAVE_WARP_FREQ, seed ^ 0xCAFE) * CAVE_WARP_AMP;
    let caveWarpY = cy + valueNoise(cx+200, cy, cz, CAVE_WARP_FREQ, seed ^ 0xFACE) * CAVE_WARP_AMP;
    let caveWarpZ = cz + valueNoise(cx, cy+200, cz, CAVE_WARP_FREQ, seed ^ 0xBABE) * CAVE_WARP_AMP;
    let caveField = valueNoise(caveWarpX, caveWarpY, caveWarpZ, CAVE_FREQ, seed ^ 0xDEAD);
    density -= Math.max(0, caveField - 0.45) * CAVE_STRENGTH;

    density += isoLevelBias;

    return density;
}
self.onmessage = function(e) {
    const { type, chunkX, chunkY, chunkZ, worldSize, voxelGridSize, workerId, lodLevel, isoLevelBias, seed } = e.data;
    if (type === 'generate') {
        try {
            const N = voxelGridSize;
            const volume = new Uint8Array((N + 1) * (N + 1) * (N + 1));
            const ox = chunkX * worldSize;
            const oy = chunkY * worldSize;
            const oz = chunkZ * worldSize;
            const voxelSize = worldSize / voxelGridSize;
            for (let z = 0; z <= N; ++z) {
                for (let y = 0; y <= N; ++y) {
                    for (let x = 0; x <= N; ++x) {
                        const worldX = ox + x * voxelSize;
                        const worldY = oy + y * voxelSize;
                        const worldZ = oz + z * voxelSize;
                        const val = densityAt(worldX, worldY, worldZ, isoLevelBias, seed);
                        const v = Math.max(0, Math.min(255, Math.round((val + 16) * 8)));
                        volume[z * (N + 1) * (N + 1) + y * (N + 1) + x] = v;
                    }
                }
            }
            self.postMessage({
                type: 'complete',
                chunkX,
                chunkY,
                chunkZ,
                volume,
                voxelGridSize,
                worldSize,
                workerId,
                lodLevel
            });
        } catch (error) {
            self.postMessage({
                type: 'error',
                chunkX,
                chunkY,
                chunkZ,
                error: error.message,
                workerId,
                lodLevel
            });
        }
    }
};
`;

export function createChunkWorker(workerId: number): Worker {
    const blob = new Blob([workerScript], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));
    return worker;
}