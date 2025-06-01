import { mat4, vec3 } from "gl-matrix";

export enum FrustumResult {
    OUTSIDE = 0,
    INTERSECTS = 1,
    INSIDE = 2
}

export interface AABB {
    min: vec3;
    max: vec3;
}

export class Frustum {
    private planes: Float32Array[] = [];

    constructor() {
        // Initialize 6 frustum planes (each plane is [a, b, c, d] where ax + by + cz + d = 0)
        for (let i = 0; i < 6; i++) {
            this.planes.push(new Float32Array(4));
        }
    }

    public updateFromMatrix(projViewMatrix: mat4): void {
        const m = projViewMatrix;
        
        // Extract frustum planes from projection-view matrix
        // Left plane: m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]
        this.planes[0][0] = m[3] + m[0];
        this.planes[0][1] = m[7] + m[4];
        this.planes[0][2] = m[11] + m[8];
        this.planes[0][3] = m[15] + m[12];
        
        // Right plane: m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]
        this.planes[1][0] = m[3] - m[0];
        this.planes[1][1] = m[7] - m[4];
        this.planes[1][2] = m[11] - m[8];
        this.planes[1][3] = m[15] - m[12];
        
        // Bottom plane: m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]
        this.planes[2][0] = m[3] + m[1];
        this.planes[2][1] = m[7] + m[5];
        this.planes[2][2] = m[11] + m[9];
        this.planes[2][3] = m[15] + m[13];
        
        // Top plane: m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]
        this.planes[3][0] = m[3] - m[1];
        this.planes[3][1] = m[7] - m[5];
        this.planes[3][2] = m[11] - m[9];
        this.planes[3][3] = m[15] - m[13];
        
        // Near plane: m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]
        this.planes[4][0] = m[3] + m[2];
        this.planes[4][1] = m[7] + m[6];
        this.planes[4][2] = m[11] + m[10];
        this.planes[4][3] = m[15] + m[14];
        
        // Far plane: m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]
        this.planes[5][0] = m[3] - m[2];
        this.planes[5][1] = m[7] - m[6];
        this.planes[5][2] = m[11] - m[10];
        this.planes[5][3] = m[15] - m[14];

        // Normalize planes
        for (let i = 0; i < 6; i++) {
            const length = Math.sqrt(
                this.planes[i][0] * this.planes[i][0] + 
                this.planes[i][1] * this.planes[i][1] + 
                this.planes[i][2] * this.planes[i][2]
            );
            if (length > 0) {
                this.planes[i][0] /= length;
                this.planes[i][1] /= length;
                this.planes[i][2] /= length;
                this.planes[i][3] /= length;
            }
        }
    }

    public testAABB(aabb: AABB): FrustumResult {
        let result = FrustumResult.INSIDE;

        for (let i = 0; i < 6; i++) {
            const plane = this.planes[i];
            
            // Find the positive and negative vertices relative to plane normal
            let pVertex = vec3.create();
            let nVertex = vec3.create();
            
            // X component
            if (plane[0] >= 0) {
                pVertex[0] = aabb.max[0];
                nVertex[0] = aabb.min[0];
            } else {
                pVertex[0] = aabb.min[0];
                nVertex[0] = aabb.max[0];
            }
            
            // Y component
            if (plane[1] >= 0) {
                pVertex[1] = aabb.max[1];
                nVertex[1] = aabb.min[1];
            } else {
                pVertex[1] = aabb.min[1];
                nVertex[1] = aabb.max[1];
            }
            
            // Z component
            if (plane[2] >= 0) {
                pVertex[2] = aabb.max[2];
                nVertex[2] = aabb.min[2];
            } else {
                pVertex[2] = aabb.min[2];
                nVertex[2] = aabb.max[2];
            }

            // Test distances (plane equation: ax + by + cz + d = 0)
            const pDistance = plane[0] * pVertex[0] + plane[1] * pVertex[1] + plane[2] * pVertex[2] + plane[3];
            const nDistance = plane[0] * nVertex[0] + plane[1] * nVertex[1] + plane[2] * nVertex[2] + plane[3];

            // If positive vertex is behind plane, box is completely outside
            if (pDistance < 0) {
                return FrustumResult.OUTSIDE;
            }
            // If negative vertex is behind plane, box intersects
            if (nDistance < 0) {
                result = FrustumResult.INTERSECTS;
            }
        }

        return result;
    }
}

export function createAABBForChunk(
    chunkX: number, 
    chunkY: number, 
    chunkZ: number, 
    worldSize: number
): AABB {
    const min = vec3.fromValues(
        chunkX * worldSize,
        chunkY * worldSize,
        chunkZ * worldSize
    );
    const max = vec3.fromValues(
        (chunkX + 1) * worldSize,
        (chunkY + 1) * worldSize,
        (chunkZ + 1) * worldSize
    );
    
    return { min, max };
}