export const PLANET_RADIUS = 800;
export const PLANET_RADIUS_MIN = 600;
export const PLANET_RADIUS_MAX = 900;
const PLANET_CENTER = [0, 0, 0];
const PLANET_WARP = 55;
const PLANET_NOISE_OCTAVES = 5;
const PLANET_NOISE_FREQ = 0.026;
const PLANET_NOISE_AMP = 1.0;
const SPHERE_DISTORT_FREQ = 0.052;
const SPHERE_DISTORT_AMP = 25.0;

// Large-scale mountain belts and plateaus
const BELT_FREQ = 0.008;
const BELT_AMP = 120.0;
const ARCH_FREQ = 0.013;
const ARCH_AMP = 60.0;

// Craters
const CRATER_FREQ = 0.008;
const CRATER_RADIUS = 55.0;
const CRATER_DEPTH = 32.0;

// Caves
const CAVE_FREQ = 0.012;
const CAVE_STRENGTH = 12.0;
const CAVE_WARP_FREQ = 0.008;
const CAVE_WARP_AMP = 24.0;

function smoothstep(edge0: number, edge1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

function hash(x: number, y: number, z: number, seed: number): number {
    let h = x * 374761393 + y * 668265263 + z * 2147483647 + seed * 2654435761;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) & 0x7fffffff) / 0x3fffffff - 1.0;
}

function valueNoise(x: number, y: number, z: number, freq: number, seed: number): number {
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
    function lerp(a: number, b: number, t: number) { return a + (b-a)*t; }
    let v00 = lerp(v000, v100, fx);
    let v01 = lerp(v001, v101, fx);
    let v10 = lerp(v010, v110, fx);
    let v11 = lerp(v011, v111, fx);
    let v0 = lerp(v00, v10, fy);
    let v1 = lerp(v01, v11, fy);
    return lerp(v0, v1, fz);
}

export function densityAtSeeded(x: number, y: number, z: number, seed: number, isoLevelBias: number): number {
    let cx = x - PLANET_CENTER[0];
    let cy = y - PLANET_CENTER[1];
    let cz = z - PLANET_CENTER[2];

    // 1. Sphere distortion (large-scale)
    let sphereDistort = valueNoise(cx, cy, cz, SPHERE_DISTORT_FREQ, seed ^ 0xBEEF) * SPHERE_DISTORT_AMP;

    // 2. Warped coordinates for belts/arches
    let wx = cx + valueNoise(cx+1000, cy, cz, 0.012, seed ^ 125) * PLANET_WARP;
    let wy = cy + valueNoise(cx, cy+1000, cz, 0.012, seed ^ 126) * PLANET_WARP;
    let wz = cz + valueNoise(cx, cy, cz+1000, 0.012, seed ^ 127) * PLANET_WARP;

    // 3. Main planet surface noise (medium scale)
    let amp = PLANET_NOISE_AMP, freq = PLANET_NOISE_FREQ, sum = 0, norm = 0;
    for (let i = 0; i < PLANET_NOISE_OCTAVES; ++i) {
        sum += amp * valueNoise(wx, wy, wz, freq, seed ^ (1000 + i * 17));
        norm += amp;
        freq *= 2.03;
        amp *= 0.54;
    }
    let surfaceNoise = sum / norm * 36.0;

    // 4. Mountain belts (use sin/cos for "ridges" and valueNoise for wildness)
    let belt = Math.abs(Math.sin(wx * BELT_FREQ + Math.cos(wy * (BELT_FREQ * 0.7)))) * BELT_AMP;
    belt *= 0.6 + 0.4 * Math.abs(valueNoise(wx, wy, wz, BELT_FREQ * 0.8, seed ^ 0xB1B1));

    // 5. Arches/plateaus (mask to only show up in certain regions)
    let archMask = smoothstep(-0.2, 0.5, valueNoise(wx, wy, wz, ARCH_FREQ * 0.75, seed ^ 0xA9A9));
    let arch = archMask * Math.abs(Math.sin((wx + wz) * ARCH_FREQ + Math.cos(wy * 0.013))) * ARCH_AMP;

    // 6. Craters (rare, large, true bowls with rim, anywhere)
    let craters = 0;
    for (let i = 0; i < 2; ++i) {
        const cseed = (seed ^ 0xC0DE ^ (i * 0x1F1F)) & 0x7fffffff;
        const craterCenterX = Math.floor((wx + 4000 + i * 2000) / 320) * 320 + hash(i, 0, 0, cseed) * 170;
        const craterCenterY = Math.floor((wy + 4000 + i * 2000) / 320) * 320 + hash(0, i, 0, cseed) * 170;
        const craterCenterZ = Math.floor((wz + 4000 + i * 2000) / 320) * 320 + hash(0, 0, i, cseed) * 170;
        const dx = wx - craterCenterX, dy = wy - craterCenterY, dz = wz - craterCenterZ;
        const d2 = dx*dx + dy*dy + dz*dz;
        const r = CRATER_RADIUS * (0.7 + 0.7 * Math.abs(hash(i, i, i, cseed)));
        if (d2 < r*r) {
            const d = Math.sqrt(d2) / r;
            const bowl = -CRATER_DEPTH * Math.pow(1 - d, 2.5) * smoothstep(0.0, 1.0, 1 - d);
            const rim = CRATER_DEPTH * 0.34 * Math.exp(-Math.pow((d-1.07)/0.16, 2));
            craters += (bowl + rim);
        }
    }

    // 7. Elevation (combine wild features, but not too much small scale)
    let elevation =
        surfaceNoise +
        belt +
        arch +
        craters;

    // 8. Final Distance from center (sphere)
    let dist = Math.sqrt(cx*cx + cy*cy + cz*cz) + sphereDistort + elevation;

    // 9. Caves (rare, wild, multi-octave, but not everywhere)
    let caveNoise = 0, caveAmp = 1, caveFreq = CAVE_FREQ, caveNorm = 0;
    let caveWarpX = cx, caveWarpY = cy, caveWarpZ = cz;
    for (let i = 0; i < 2; ++i) {
        caveWarpX += valueNoise(cx, cy, cz, CAVE_WARP_FREQ * (i+1), seed ^ (0xCAFE + i*11)) * CAVE_WARP_AMP;
        caveWarpY += valueNoise(cx+200, cy, cz, CAVE_WARP_FREQ * (i+1), seed ^ (0xFACE + i*7)) * CAVE_WARP_AMP;
        caveWarpZ += valueNoise(cx, cy+200, cz, CAVE_WARP_FREQ * (i+1), seed ^ (0xBABE + i*5)) * CAVE_WARP_AMP;
        caveNoise += caveAmp * valueNoise(caveWarpX, caveWarpY, caveWarpZ, caveFreq, seed ^ (0xDEAD + i*17));
        caveNorm += caveAmp;
        caveFreq *= 1.5;
        caveAmp *= 0.7;
    }
    caveNoise = caveNoise / caveNorm;
    let cave = -Math.max(0, caveNoise - 0.59) * CAVE_STRENGTH;

    // 10. Bias
    let density = PLANET_RADIUS - dist + cave + isoLevelBias;
    return density;
}