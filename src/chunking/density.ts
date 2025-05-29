// ---- Tunable Parameters ----
export const PLANET_RADIUS = 80;         // Radius of planetoid
const PLANET_CENTER = [0, 0, 0];  // Center of the world
const PLANET_WARP = 55;           // How much to warp the planet surface (higher = wilder)
const PLANET_NOISE_OCTAVES = 6;   // Number of noise octaves for surface
const PLANET_NOISE_FREQ = 0.03;   // Base freq for surface noise
const PLANET_NOISE_AMP = 1.0;     // Base amplitude for surface noise
const CAVE_FREQ = 0.05;           // Frequency of caves
const CAVE_STRENGTH = 10.0;       // Strength of cave carving
const CAVE_WARP_FREQ = 0.013;     // Warping for caves
const CAVE_WARP_AMP = 32.0;       // How much to warp the cave field
const SPHERE_DISTORT_FREQ = 0.06; // Large-scale distortion of sphere
const SPHERE_DISTORT_AMP = 18.0;   // How much to distort the sphere
const CRATER_FREQ = 0.01;         // Frequency of craters
const CRATER_STRENGTH = 3.0;     // How deep the craters are

// -- Value noise (replace with better noise if desired) --
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

// -- Main density function --
export function densityAtSeeded(x: number, y: number, z: number, seed: number, isoLevelBias: number): number {
    // Center coordinates
    let cx = x - PLANET_CENTER[0];
    let cy = y - PLANET_CENTER[1];
    let cz = z - PLANET_CENTER[2];

    // Large-scale sphere distortion (makes the planet "potatoid")
    let sphereDistort = valueNoise(
        cx, cy, cz, SPHERE_DISTORT_FREQ, seed ^ 0xBEEF
    ) * SPHERE_DISTORT_AMP;

    // Warped position for surface features
    let wx = cx + valueNoise(cx+1000, cy, cz, PLANET_NOISE_FREQ*0.33, seed ^ 125) * PLANET_WARP;
    let wy = cy + valueNoise(cx, cy+1000, cz, PLANET_NOISE_FREQ*0.33, seed ^ 126) * PLANET_WARP;
    let wz = cz + valueNoise(cx, cy, cz+1000, PLANET_NOISE_FREQ*0.33, seed ^ 127) * PLANET_WARP;

    // Surface multi-octave noise
    let amp = PLANET_NOISE_AMP, freq = PLANET_NOISE_FREQ, sum = 0, norm = 0;
    for (let i = 0; i < PLANET_NOISE_OCTAVES; ++i) {
        sum += amp * valueNoise(wx, wy, wz, freq, seed ^ (1000 + i * 17));
        norm += amp;
        freq *= 2.03;
        amp *= 0.53;
    }
    let surfaceNoise = sum / norm * 21.0; // scale for wildness

    // Craters (negative bumps)
    let craterNoise = valueNoise(wx, wy, wz, CRATER_FREQ, seed ^ 0xC0DE);
    let crater = Math.max(0, craterNoise - 0.55) * -CRATER_STRENGTH;

    // Distance from center, with distortion
    let dist = Math.sqrt(cx*cx + cy*cy + cz*cz) + sphereDistort + surfaceNoise + crater;

    // Planet surface at PLANET_RADIUS
    let density = PLANET_RADIUS - dist;

    // Caves: carve with mid-frequency noise, warped
    let caveWarpX = cx + valueNoise(cx, cy, cz, CAVE_WARP_FREQ, seed ^ 0xCAFE) * CAVE_WARP_AMP;
    let caveWarpY = cy + valueNoise(cx+200, cy, cz, CAVE_WARP_FREQ, seed ^ 0xFACE) * CAVE_WARP_AMP;
    let caveWarpZ = cz + valueNoise(cx, cy+200, cz, CAVE_WARP_FREQ, seed ^ 0xBABE) * CAVE_WARP_AMP;
    let caveField = valueNoise(caveWarpX, caveWarpY, caveWarpZ, CAVE_FREQ, seed ^ 0xDEAD);
    density -= Math.max(0, caveField - 0.45) * CAVE_STRENGTH;

    // Optionally, add more "ridges" or "arches" with further noise...

    // Iso level bias (for LOD shrink/fatten)
    density += isoLevelBias;

    return density;
}