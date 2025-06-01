export interface MaterialWeights {
    rock: number;
    grass: number;
    dirt: number;
    sand: number;
}

export class MaterialSystem {
    private static readonly PLANET_CENTER = [0, 0, 0];
    private static readonly PLANET_RADIUS = 80;

    public static calculateMaterialWeights(
        worldPos: [number, number, number],
        worldNormal: [number, number, number]
    ): MaterialWeights {
        const [x, y, z] = worldPos;
        const [nx, ny, nz] = worldNormal;

        // Calculate radial direction from planet center
        const toCenterX = MaterialSystem.PLANET_CENTER[0] - x;
        const toCenterY = MaterialSystem.PLANET_CENTER[1] - y;
        const toCenterZ = MaterialSystem.PLANET_CENTER[2] - z;
        
        const distanceFromCenter = Math.sqrt(toCenterX * toCenterX + toCenterY * toCenterY + toCenterZ * toCenterZ);
        
        // Normalize radial direction
        const radialDirX = toCenterX / distanceFromCenter;
        const radialDirY = toCenterY / distanceFromCenter;
        const radialDirZ = toCenterZ / distanceFromCenter;

        // Calculate surface alignment (how perpendicular surface is to radius)
        const surfaceAlignment = Math.abs(nx * radialDirX + ny * radialDirY + nz * radialDirZ);
        
        // Calculate slope (0 = flat relative to planet, 1 = vertical cliff)
        const slope = 1.0 - surfaceAlignment;
        
        // Calculate altitude relative to planet surface
        const altitude = distanceFromCenter - MaterialSystem.PLANET_RADIUS;
        
        // Calculate latitude-like effect
        const latitudeFactor = Math.abs(y) / MaterialSystem.PLANET_RADIUS;

        // Material assignment (exact same logic as fragment shader)
        
        // ROCK: Steep slopes and high altitude areas
        let rockWeight = MaterialSystem.smoothstep(0.25, 0.6, slope) + 
                        MaterialSystem.smoothstep(10.0, 20.0, altitude) * 0.9 +
                        MaterialSystem.smoothstep(0.6, 0.8, latitudeFactor) * 0.6;
        
        // GRASS: Flat areas at moderate altitude
        let grassWeight = MaterialSystem.smoothstep(0.7, 0.3, slope) * 
                         MaterialSystem.smoothstep(-2.0, 12.0, altitude) * 
                         MaterialSystem.smoothstep(0.7, 0.2, latitudeFactor) * 
                         MaterialSystem.smoothstep(15.0, 5.0, altitude);
        
        // DIRT: Medium slopes and transition zones
        let dirtWeight = MaterialSystem.smoothstep(0.15, 0.5, slope) * 
                        MaterialSystem.smoothstep(0.5, 0.15, slope) * 
                        MaterialSystem.smoothstep(-8.0, 25.0, altitude) +
                        MaterialSystem.smoothstep(0.4, 0.7, slope) * 
                        MaterialSystem.smoothstep(0.7, 0.4, slope) * 0.3;
        
        // SAND: Coastal areas with smooth transitions
        const seaLevelFactor = MaterialSystem.smoothstep(5.0, -3.0, altitude) * 
                              MaterialSystem.smoothstep(-3.0, -10.0, altitude);
        const flatFactor = MaterialSystem.smoothstep(0.5, 0.05, slope);
        const coastalFactor = MaterialSystem.smoothstep(0.6, 0.15, latitudeFactor);
        
        let sandWeight = seaLevelFactor * flatFactor * coastalFactor * 0.7;

        // Add noise variation for natural look
        const noise1 = Math.sin(x * 0.04) * Math.sin(z * 0.04) * 0.25 + 0.75;
        const noise2 = Math.sin(x * 0.07 + 50.0) * Math.sin(y * 0.07) * 0.2 + 0.8;
        const noise3 = Math.sin(x * 0.03) * Math.sin(z * 0.03) * 0.3 + 0.7;

        // Apply noise to create natural variation
        grassWeight *= noise1;
        dirtWeight *= noise2;
        rockWeight *= noise3;

        // Sand gets smoother noise treatment
        const sandNoise = Math.sin(x * 0.02) * Math.sin(z * 0.02) * 0.4 + 0.6;
        sandWeight *= sandNoise;

        // Add random rock outcrops
        const rockPatchNoise = Math.sin(x * 0.015) * Math.sin(y * 0.015) * Math.sin(z * 0.015);
        const rockOutcrop = MaterialSystem.smoothstep(0.7, 0.8, rockPatchNoise);
        rockWeight += rockOutcrop * 0.4;
        sandWeight *= (1.0 - rockOutcrop * 0.8);

        // Smooth altitude-based sand reduction
        sandWeight *= MaterialSystem.smoothstep(8.0, 3.0, altitude);

        // Add subtle blending between materials
        const blendStrength = 0.15;
        const avgWeight = (rockWeight + grassWeight + dirtWeight) / 3.0;
        rockWeight = MaterialSystem.mix(rockWeight, avgWeight, blendStrength * 0.3);
        grassWeight = MaterialSystem.mix(grassWeight, avgWeight, blendStrength * 0.4);
        dirtWeight = MaterialSystem.mix(dirtWeight, avgWeight, blendStrength * 0.5);

        // Ensure minimum material presence
        rockWeight = Math.max(rockWeight, 0.08);
        grassWeight = Math.max(grassWeight, 0.04);
        dirtWeight = Math.max(dirtWeight, 0.08);
        sandWeight = Math.max(sandWeight, 0.01);

        // Normalize weights
        const total = rockWeight + grassWeight + dirtWeight + sandWeight;
        if (total > 0.001) {
            return {
                rock: rockWeight / total,
                grass: grassWeight / total,
                dirt: dirtWeight / total,
                sand: sandWeight / total
            };
        } else {
            return { rock: 0.4, grass: 0.3, dirt: 0.3, sand: 0.0 };
        }
    }

    // Utility functions
    private static smoothstep(edge0: number, edge1: number, x: number): number {
        const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
        return t * t * (3 - 2 * t);
    }

    private static mix(a: number, b: number, t: number): number {
        return a + (b - a) * t;
    }

    public static calculateTriplanarWeights(normal: [number, number, number]): [number, number, number] {
        const [nx, ny, nz] = normal;
        let absX = Math.abs(nx);
        let absY = Math.abs(ny);
        let absZ = Math.abs(nz);
        
        // Use power 4 for soft blending
        absX = Math.pow(absX, 4.0);
        absY = Math.pow(absY, 4.0);
        absZ = Math.pow(absZ, 4.0);
        
        const sum = absX + absY + absZ;
        if (sum > 0.001) {
            return [absX / sum, absY / sum, absZ / sum];
        } else {
            return [0, 1, 0]; // Default to Y-axis
        }
    }
}