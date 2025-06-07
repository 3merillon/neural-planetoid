export interface MaterialWeights {
    rock: number;
    grass: number;
    dirt: number;
    sand: number;
}

export class MaterialSystem {
    private static readonly PLANET_CENTER = [0, 0, 0];
    private static readonly PLANET_RADIUS = 800;
    private static readonly NOISE_RANGE = 200;

    // Higher amplitude, higher frequency for bubbly inclusions
    private static noise(x: number, y: number, z: number, freq: number, seed: number): number {
        const ix = Math.floor(x * freq), iy = Math.floor(y * freq), iz = Math.floor(z * freq);
        const fx = x * freq - ix, fy = y * freq - iy, fz = z * freq - iz;
        function hash(a: number, b: number, c: number, s: number) {
            let h = a * 374761393 + b * 668265263 + c * 2147483647 + s * 2654435761;
            h = (h ^ (h >> 13)) * 1274126177;
            return ((h ^ (h >> 16)) & 0x7fffffff) / 0x7fffffff;
        }
        function lerp(a: number, b: number, t: number) { return a + (b-a)*t; }
        const v000 = hash(ix, iy, iz, seed);
        const v100 = hash(ix+1, iy, iz, seed);
        const v010 = hash(ix, iy+1, iz, seed);
        const v110 = hash(ix+1, iy+1, iz, seed);
        const v001 = hash(ix, iy, iz+1, seed);
        const v101 = hash(ix+1, iy, iz+1, seed);
        const v011 = hash(ix, iy+1, iz+1, seed);
        const v111 = hash(ix+1, iy+1, iz+1, seed);
        const v00 = lerp(v000, v100, fx);
        const v01 = lerp(v001, v101, fx);
        const v10 = lerp(v010, v110, fx);
        const v11 = lerp(v011, v111, fx);
        const v0 = lerp(v00, v10, fy);
        const v1 = lerp(v01, v11, fy);
        return lerp(v0, v1, fz);
    }

    public static calculateMaterialWeights(
        worldPos: [number, number, number],
        worldNormal: [number, number, number]
    ): MaterialWeights {
        const [x, y, z] = worldPos;
        const [nx, ny, nz] = worldNormal;

        const R = MaterialSystem.PLANET_RADIUS;
        const N = MaterialSystem.NOISE_RANGE;

        const toCenterX = MaterialSystem.PLANET_CENTER[0] - x;
        const toCenterY = MaterialSystem.PLANET_CENTER[1] - y;
        const toCenterZ = MaterialSystem.PLANET_CENTER[2] - z;
        const distanceFromCenter = Math.sqrt(toCenterX * toCenterX + toCenterY * toCenterY + toCenterZ * toCenterZ);
        const altitude = distanceFromCenter - R;

        // Normalize altitude to [0,1] based on noise range
        const altitudeNorm = (altitude + N/2) / N;

        const radialDirX = -toCenterX / distanceFromCenter;
        const radialDirY = -toCenterY / distanceFromCenter;
        const radialDirZ = -toCenterZ / distanceFromCenter;
        const surfaceAlignment = nx * radialDirX + ny * radialDirY + nz * radialDirZ;
        const slope = 1.0 - Math.abs(surfaceAlignment);

        // Noisy thresholds for bubbly transitions
        const sandNoise = this.noise(x, y, z, 0.035, 1234) * 0.10 - 0.05;
        const grassNoise = this.noise(x, y, z, 0.045, 5678) * 0.10 - 0.05;
        const dirtNoise = this.noise(x, y, z, 0.027, 91011) * 0.10 - 0.05;

        // Minimal noise for blending
        const blendNoise = 0.99 + 0.01 * Math.sin(x * 0.01 + z * 0.01);

        // SAND: only at low altitude, fades out quickly above sea level, with noisy transition
        let sand = this.smoothstep(0.10 + sandNoise, 0.03 + sandNoise, altitudeNorm) * this.smoothstep(0.0, 0.18, slope);

        // ROCK: only on very steep slopes, above sand, with noisy transition
        let rock = (1.0 - sand) * this.smoothstep(0.38 + dirtNoise, 0.50 + dirtNoise, slope);

        // GRASS: dominates nearly all non-steep, non-sandy areas, with noisy transition
        let grass =
            (1.0 - sand) *
            this.smoothstep(0.10 + grassNoise, 0.93 + grassNoise, altitudeNorm) *
            this.smoothstep(0.0, 0.48, slope) *
            (1.0 - this.smoothstep(0.97, 1.0, altitudeNorm));

        grass = Math.pow(grass, 0.07);

        // DIRT: buffer between grass and rock, always smoothly blended, but clamp to a very small minimum
        let dirt = 1.0 - sand - grass - rock;
        dirt = Math.max(Math.min(dirt, 0.15), 0.001);

        // Add a little blending noise to grass/dirt, but not sand/rock
        grass *= blendNoise;
        dirt *= blendNoise * 1.01;

        sand = Math.max(sand, 0.001);
        grass = Math.max(grass, 0.001);
        rock = Math.max(rock, 0.001);

        // Normalize
        const total = sand + grass + dirt + rock;
        return {
            sand: sand / total,
            grass: grass / total,
            dirt: dirt / total,
            rock: rock / total
        };
    }

    private static smoothstep(edge0: number, edge1: number, x: number): number {
        const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
        return t * t * (3 - 2 * t);
    }
}