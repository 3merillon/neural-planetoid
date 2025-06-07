import { mat4, vec3 } from "gl-matrix";
import { PLANET_RADIUS_MIN, PLANET_RADIUS_MAX, PLANET_RADIUS } from "./density";

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
    private planetCenter: vec3 = vec3.fromValues(0, 0, 0);

    constructor() {
        for (let i = 0; i < 6; i++) {
            this.planes.push(new Float32Array(4));
        }
    }

    public updateFromMatrix(projViewMatrix: mat4): void {
        const m = projViewMatrix;
        this.planes[0][0] = m[3] + m[0];
        this.planes[0][1] = m[7] + m[4];
        this.planes[0][2] = m[11] + m[8];
        this.planes[0][3] = m[15] + m[12];
        this.planes[1][0] = m[3] - m[0];
        this.planes[1][1] = m[7] - m[4];
        this.planes[1][2] = m[11] - m[8];
        this.planes[1][3] = m[15] - m[12];
        this.planes[2][0] = m[3] + m[1];
        this.planes[2][1] = m[7] + m[5];
        this.planes[2][2] = m[11] + m[9];
        this.planes[2][3] = m[15] + m[13];
        this.planes[3][0] = m[3] - m[1];
        this.planes[3][1] = m[7] - m[5];
        this.planes[3][2] = m[11] - m[9];
        this.planes[3][3] = m[15] - m[13];
        this.planes[4][0] = m[3] + m[2];
        this.planes[4][1] = m[7] + m[6];
        this.planes[4][2] = m[11] + m[10];
        this.planes[4][3] = m[15] + m[14];
        this.planes[5][0] = m[3] - m[2];
        this.planes[5][1] = m[7] - m[6];
        this.planes[5][2] = m[11] - m[10];
        this.planes[5][3] = m[15] - m[14];

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
            let pVertex = vec3.create();
            let nVertex = vec3.create();
            if (plane[0] >= 0) {
                pVertex[0] = aabb.max[0];
                nVertex[0] = aabb.min[0];
            } else {
                pVertex[0] = aabb.min[0];
                nVertex[0] = aabb.max[0];
            }
            if (plane[1] >= 0) {
                pVertex[1] = aabb.max[1];
                nVertex[1] = aabb.min[1];
            } else {
                pVertex[1] = aabb.min[1];
                nVertex[1] = aabb.max[1];
            }
            if (plane[2] >= 0) {
                pVertex[2] = aabb.max[2];
                nVertex[2] = aabb.min[2];
            } else {
                pVertex[2] = aabb.min[2];
                nVertex[2] = aabb.max[2];
            }
            const pDistance = plane[0] * pVertex[0] + plane[1] * pVertex[1] + plane[2] * pVertex[2] + plane[3];
            const nDistance = plane[0] * nVertex[0] + plane[1] * nVertex[1] + plane[2] * nVertex[2] + plane[3];
            if (pDistance < 0) {
                return FrustumResult.OUTSIDE;
            }
            if (nDistance < 0) {
                result = FrustumResult.INTERSECTS;
            }
        }
        return result;
    }

    public testAABBWithPlanetOcclusion(aabb: AABB, cameraPos: vec3): FrustumResult {
        const frustumResult = this.testAABB(aabb);
        if (frustumResult === FrustumResult.OUTSIDE) {
            return FrustumResult.OUTSIDE;
        }

        const occlusionResult = this.testPlanetOcclusion(aabb, cameraPos);
        if (occlusionResult === FrustumResult.OUTSIDE) {
            return FrustumResult.OUTSIDE;
        }

        if (frustumResult === FrustumResult.INTERSECTS || occlusionResult === FrustumResult.INTERSECTS) {
            return FrustumResult.INTERSECTS;
        }
        
        return FrustumResult.INSIDE;
    }

    private testPlanetOcclusion(aabb: AABB, cameraPos: vec3): FrustumResult {
        const cameraToPlanet = vec3.sub(vec3.create(), this.planetCenter, cameraPos);
        const distanceToPlanet = vec3.length(cameraToPlanet);
        
        if (distanceToPlanet < PLANET_RADIUS_MIN) {
            return FrustumResult.INSIDE;
        }

        const cameraToPlanetDir = vec3.normalize(vec3.create(), cameraToPlanet);
        
        const coneHalfAngle = Math.asin(PLANET_RADIUS_MIN / distanceToPlanet);
        const cosHalfAngle = Math.cos(coneHalfAngle);

        const tangentDistance = Math.sqrt(distanceToPlanet * distanceToPlanet - PLANET_RADIUS_MIN * PLANET_RADIUS_MIN);

        const corners = [
            vec3.fromValues(aabb.min[0], aabb.min[1], aabb.min[2]),
            vec3.fromValues(aabb.min[0], aabb.min[1], aabb.max[2]),
            vec3.fromValues(aabb.min[0], aabb.max[1], aabb.min[2]),
            vec3.fromValues(aabb.min[0], aabb.max[1], aabb.max[2]),
            vec3.fromValues(aabb.max[0], aabb.min[1], aabb.min[2]),
            vec3.fromValues(aabb.max[0], aabb.min[1], aabb.max[2]),
            vec3.fromValues(aabb.max[0], aabb.max[1], aabb.min[2]),
            vec3.fromValues(aabb.max[0], aabb.max[1], aabb.max[2])
        ];

        let occludedCorners = 0;
        let visibleCorners = 0;

        for (const corner of corners) {
            const cameraToCorner = vec3.sub(vec3.create(), corner, cameraPos);
            const distanceToCorner = vec3.length(cameraToCorner);
            
            const cameraToCornerDir = vec3.normalize(vec3.create(), cameraToCorner);
            
            const dotProduct = vec3.dot(cameraToPlanetDir, cameraToCornerDir);
            const angleToCorner = Math.acos(Math.min(1.0, Math.max(-1.0, dotProduct)));
            
            const isInCone = angleToCorner <= coneHalfAngle;
            
            const projectedDistance = dotProduct * distanceToCorner;
            
            if (isInCone && projectedDistance > tangentDistance) {
                occludedCorners++;
            } else {
                visibleCorners++;
            }
        }

        if (occludedCorners === 8) {
            return FrustumResult.OUTSIDE;
        }
        
        if (occludedCorners > 0) {
            return FrustumResult.INTERSECTS;
        }

        return FrustumResult.INSIDE;
    }

    public setPlanetCenter(center: vec3): void {
        vec3.copy(this.planetCenter, center);
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