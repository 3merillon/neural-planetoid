import { densityAtSeeded } from "./density";
import { ChunkConfigManager } from "./chunk-config";

export function computeNormalsFieldGradientJS(
    positions: Float32Array,
    seed: number,
    isoLevelBias: number,
    eps: number = 0.5
): Float32Array {
    const normals = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i], y = positions[i+1], z = positions[i+2];
        const fx1 = densityAtSeeded(x + eps, y, z, seed, isoLevelBias);
        const fx0 = densityAtSeeded(x - eps, y, z, seed, isoLevelBias);
        const fy1 = densityAtSeeded(x, y + eps, z, seed, isoLevelBias);
        const fy0 = densityAtSeeded(x, y - eps, z, seed, isoLevelBias);
        const fz1 = densityAtSeeded(x, y, z + eps, seed, isoLevelBias);
        const fz0 = densityAtSeeded(x, y, z - eps, seed, isoLevelBias);
        let nxg = fx1 - fx0;
        let nyg = fy1 - fy0;
        let nzg = fz1 - fz0;
        const len = Math.sqrt(nxg*nxg + nyg*nyg + nzg*nzg);
        if (len > 0.0001) {
            nxg = -nxg / len;
            nyg = -nyg / len;
            nzg = -nzg / len;
        } else {
            nxg = 0; nyg = 1; nzg = 0;
        }
        normals[i] = nxg;
        normals[i+1] = nyg;
        normals[i+2] = nzg;
    }
    return normals;
}