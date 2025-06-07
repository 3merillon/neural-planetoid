import { mat4, quat, vec3 } from "gl-matrix";

function quatLookRotation(out: quat, fwd: vec3, up: vec3) {
    const z = vec3.negate(vec3.create(), fwd);
    vec3.normalize(z, z);
    const x = vec3.cross(vec3.create(), up, z);
    vec3.normalize(x, x);
    const y = vec3.cross(vec3.create(), z, x);
    vec3.normalize(y, y);
    const m = new Float32Array(9);
    m[0] = x[0]; m[1] = y[0]; m[2] = z[0];
    m[3] = x[1]; m[4] = y[1]; m[5] = z[1];
    m[6] = x[2]; m[7] = y[2]; m[8] = z[2];
    quat.fromMat3(out, m as any);
    quat.normalize(out, out);
}

function getTouchDist(e: TouchEvent): number {
    if (e.touches.length < 2) return 0;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

function getTouchCenter(e: TouchEvent): [number, number] {
    if (e.touches.length < 2) return [0, 0];
    return [
        (e.touches[0].clientX + e.touches[1].clientX) / 2,
        (e.touches[0].clientY + e.touches[1].clientY) / 2
    ];
}

function getTouchAngle(e: TouchEvent): number {
    if (e.touches.length < 2) return 0;
    const dx = e.touches[1].clientX - e.touches[0].clientX;
    const dy = e.touches[1].clientY - e.touches[0].clientY;
    return Math.atan2(dy, dx);
}

export interface FreeFlyCameraOptions {
    restrictToIsosurface?: boolean;
    densityAt?: (x: number, y: number, z: number) => number;
    isosurfaceBuffer?: number;
}

export class FreeFlyCamera {
    public position: vec3;
    public orientation: quat;
    public viewMatrix: mat4;
    public projectionMatrix: mat4;
    public moveSpeed = 5.0;
    public lookSpeed = 0.002;
    public rollSpeed = 1.0;
    private keys: Set<string> = new Set();
    public aspect: number;
    public fovy: number;
    public near: number;
    public far: number;

    private dragging = false;
    private lastMouseX = 0;
    private lastMouseY = 0;
    private lastTouchDist = 0;
    private lastTouchCenter: [number, number] = [0, 0];
    private lastTouchAngle = 0;
    private smoothZoomVelocity = 0;
    private targetZoomDelta = 0;
    private smoothRollVelocity = 0;
    private targetRollDelta = 0;

    private restrictToIsosurface = true;
    private densityAt: ((x: number, y: number, z: number) => number) | null = null;
    private isosurfaceBuffer: number = -1.0;

    constructor(
        aspect: number,
        fovy: number = Math.PI / 3,
        near: number = 0.1,
        far: number = 1000.0,
        initialPos: [number, number, number] = [0, 0, 5],
        initialTarget: [number, number, number] = [0, 0, 0],
        initialUp: [number, number, number] = [0, 1, 0],
        options?: FreeFlyCameraOptions
    ) {
        this.aspect = aspect;
        this.fovy = fovy;
        this.near = near;
        this.far = far;

        this.position = vec3.fromValues(...initialPos);
        this.orientation = quat.create();
        const fwd = vec3.sub(vec3.create(), vec3.fromValues(...initialTarget), this.position);
        vec3.normalize(fwd, fwd);
        const up = vec3.fromValues(...initialUp);
        quatLookRotation(this.orientation, fwd, up);

        this.viewMatrix = mat4.create();
        this.projectionMatrix = mat4.perspective(mat4.create(), this.fovy, this.aspect, this.near, this.far);
        this.updateViewMatrix();

        if (options) {
            if (options.restrictToIsosurface !== undefined) this.restrictToIsosurface = options.restrictToIsosurface;
            if (options.densityAt) this.densityAt = options.densityAt;
            if (options.isosurfaceBuffer !== undefined) this.isosurfaceBuffer = options.isosurfaceBuffer;
        }
    }

    private isMenuVisible(): boolean {
        const menu = document.getElementById("menu");
        return menu ? !menu.classList.contains("hidden") : false;
    }

    private isInActiveMenuArea(x: number, y: number): boolean {
        if (!this.isMenuVisible()) return false;
        const menu = document.getElementById("menu");
        if (!menu) return false;
        const rect = menu.getBoundingClientRect();
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }

    public attach(canvas: HTMLCanvasElement) {
        canvas.style.touchAction = 'none';
        window.addEventListener("keydown", (e) => this.keys.add(e.code.toLowerCase()));
        window.addEventListener("keyup", (e) => this.keys.delete(e.code.toLowerCase()));
        canvas.addEventListener("mousedown", (e) => {
            if (e.button === 0) {
                this.dragging = true;
                this.lastMouseX = e.clientX;
                this.lastMouseY = e.clientY;
            }
        });
        window.addEventListener("mousemove", (e) => {
            if (this.dragging) {
                const dx = e.clientX - this.lastMouseX;
                const dy = e.clientY - this.lastMouseY;
                this.handleMouseLook(dx, dy);
                this.lastMouseX = e.clientX;
                this.lastMouseY = e.clientY;
            }
        });
        window.addEventListener("mouseup", () => { this.dragging = false; });

        canvas.addEventListener("touchstart", (e) => {
            e.preventDefault();
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                const isOverMenu = this.isInActiveMenuArea(touch.clientX, touch.clientY);
                if (!isOverMenu) {
                    this.dragging = true;
                    this.lastMouseX = touch.clientX;
                    this.lastMouseY = touch.clientY;
                }
            } else if (e.touches.length === 2) {
                this.dragging = false;
                this.lastTouchDist = getTouchDist(e);
                this.lastTouchCenter = getTouchCenter(e);
                this.lastTouchAngle = getTouchAngle(e);
                this.smoothZoomVelocity = 0;
                this.targetZoomDelta = 0;
                this.smoothRollVelocity = 0;
                this.targetRollDelta = 0;
            }
        }, { passive: false });

        canvas.addEventListener("touchmove", (e) => {
            e.preventDefault();
            if (e.touches.length === 1 && this.dragging) {
                const touch = e.touches[0];
                const dx = touch.clientX - this.lastMouseX;
                const dy = touch.clientY - this.lastMouseY;
                this.handleMouseLook(dx, dy);
                this.lastMouseX = touch.clientX;
                this.lastMouseY = touch.clientY;
            } else if (e.touches.length === 2) {
                const dist = getTouchDist(e);
                const center = getTouchCenter(e);
                const angle = getTouchAngle(e);
                if (this.lastTouchDist > 0) {
                    const deltaDistance = dist - this.lastTouchDist;
                    this.targetZoomDelta = deltaDistance * 0.03;
                    let deltaAngle = angle - this.lastTouchAngle;
                    if (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI;
                    if (deltaAngle < -Math.PI) deltaAngle += 2 * Math.PI;
                    this.targetRollDelta = deltaAngle * 0.5;
                }
                this.lastTouchDist = dist;
                this.lastTouchCenter = center;
                this.lastTouchAngle = angle;
            }
        }, { passive: false });

        canvas.addEventListener("touchend", (e) => {
            e.preventDefault();
            if (e.touches.length === 0) {
                this.dragging = false;
                this.targetZoomDelta = 0;
                this.targetRollDelta = 0;
            } else if (e.touches.length === 1) {
                const touch = e.touches[0];
                const isOverMenu = this.isInActiveMenuArea(touch.clientX, touch.clientY);
                if (!isOverMenu) {
                    this.dragging = true;
                    this.lastMouseX = touch.clientX;
                    this.lastMouseY = touch.clientY;
                }
                this.targetZoomDelta = 0;
                this.targetRollDelta = 0;
            } else if (e.touches.length === 2) {
                this.dragging = false;
                this.lastTouchDist = getTouchDist(e);
                this.lastTouchCenter = getTouchCenter(e);
                this.lastTouchAngle = getTouchAngle(e);
            }
        }, { passive: false });

        canvas.addEventListener("contextmenu", (e) => e.preventDefault());
        canvas.addEventListener("touchstart", (e) => {
            if (e.touches.length > 1) {
                e.preventDefault();
            }
        }, { passive: false });
        document.addEventListener("gesturestart", (e) => e.preventDefault());
        document.addEventListener("gesturechange", (e) => e.preventDefault());
        document.addEventListener("gestureend", (e) => e.preventDefault());
    }

    public setRestrictToIsosurface(enabled: boolean) {
        this.restrictToIsosurface = enabled;
    }

    handleMouseLook(dx: number, dy: number) {
        const yaw = -dx * this.lookSpeed;
        const up = this.getUp();
        const yawQuat = quat.setAxisAngle(quat.create(), up, yaw);
        quat.mul(this.orientation, yawQuat, this.orientation);

        const pitch = -dy * this.lookSpeed;
        const right = this.getRight();
        const pitchQuat = quat.setAxisAngle(quat.create(), right, pitch);
        quat.mul(this.orientation, pitchQuat, this.orientation);

        quat.normalize(this.orientation, this.orientation);
    }

    update(dt: number) {
        if (this.restrictToIsosurface && this.densityAt) {
            this.position = this.ejectFromPlanet(this.position);
        }

        let move = vec3.create();
        
        // Check for speed boost (shift key)
        const speedMultiplier = (this.keys.has("shiftleft") || this.keys.has("shiftright")) ? 5.0 : 1.0;
        
        // Movement controls
        if (this.keys.has("keyw") || this.keys.has("arrowup")) {
            vec3.add(move, move, this.getForward());
        }
        if (this.keys.has("keys") || this.keys.has("arrowdown")) {
            vec3.sub(move, move, this.getForward());
        }
        if (this.keys.has("keya") || this.keys.has("arrowleft")) {
            vec3.sub(move, move, this.getRight());
        }
        if (this.keys.has("keyd") || this.keys.has("arrowright")) {
            vec3.add(move, move, this.getRight());
        }
        if (this.keys.has("space")) {
            vec3.add(move, move, this.getUp());
        }
        if (this.keys.has("keyc")) {
            vec3.sub(move, move, this.getUp());
        }
        
        if (vec3.length(move) > 0.0001) {
            vec3.normalize(move, move);
            vec3.scale(move, move, this.moveSpeed * speedMultiplier * dt);

            if (this.restrictToIsosurface && this.densityAt) {
                this.position = this.applySoftBallConstraint(this.position, move);
                this.position = this.ejectFromPlanet(this.position);
            } else {
                vec3.add(this.position, this.position, move);
            }
        }

        if (Math.abs(this.targetZoomDelta) > 0.001) {
            this.smoothZoomVelocity += (this.targetZoomDelta - this.smoothZoomVelocity) * dt * 10;
            const move = vec3.create();
            vec3.scale(move, this.getForward(), this.smoothZoomVelocity);
            if (this.restrictToIsosurface && this.densityAt) {
                this.position = this.applySoftBallConstraint(this.position, move);
                this.position = this.ejectFromPlanet(this.position);
            } else {
                vec3.add(this.position, this.position, move);
            }
            this.targetZoomDelta *= Math.pow(0.1, dt);
            if (Math.abs(this.targetZoomDelta) < 0.001) {
                this.targetZoomDelta = 0;
                this.smoothZoomVelocity = 0;
            }
        }

        if (Math.abs(this.targetRollDelta) > 0.001) {
            this.smoothRollVelocity += (this.targetRollDelta - this.smoothRollVelocity) * dt * 8;
            if (Math.abs(this.smoothRollVelocity) > 0.0001) {
                const fwd = this.getForward();
                const rollQuat = quat.setAxisAngle(quat.create(), fwd, this.smoothRollVelocity);
                quat.mul(this.orientation, rollQuat, this.orientation);
                quat.normalize(this.orientation, this.orientation);
            }
            this.targetRollDelta *= Math.pow(0.1, dt);
            if (Math.abs(this.targetRollDelta) < 0.001) {
                this.targetRollDelta = 0;
                this.smoothRollVelocity = 0;
            }
        }

        let roll = 0;
        if (this.keys.has("keyq")) roll -= this.rollSpeed * dt;
        if (this.keys.has("keye")) roll += this.rollSpeed * dt;
        if (Math.abs(roll) > 0.0001) {
            const fwd = this.getForward();
            const rollQuat = quat.setAxisAngle(quat.create(), fwd, roll);
            quat.mul(this.orientation, rollQuat, this.orientation);
            quat.normalize(this.orientation, this.orientation);
        }

        this.updateViewMatrix();
    }

    private ejectFromPlanet(position: vec3): vec3 {
        const densityAt = this.densityAt!;
        const buffer = this.isosurfaceBuffer;
        
        const currentDensity = densityAt(position[0], position[1], position[2]);
        
        if (currentDensity >= buffer) {
            const surfaceNormal = this.estimateDensityGradient(position);
            
            let ejectedPos = vec3.clone(position);
            const maxEjectionDistance = 10.0;
            const ejectionStep = 0.2;
            
            for (let dist = ejectionStep; dist <= maxEjectionDistance; dist += ejectionStep) {
                vec3.scaleAndAdd(ejectedPos, position, surfaceNormal, -dist);
                
                const testDensity = densityAt(ejectedPos[0], ejectedPos[1], ejectedPos[2]);
                if (testDensity < buffer) {
                    return ejectedPos;
                }
            }
            
            for (let dist = ejectionStep; dist <= maxEjectionDistance; dist += ejectionStep) {
                ejectedPos = vec3.fromValues(position[0], position[1] + dist, position[2]);
                
                const testDensity = densityAt(ejectedPos[0], ejectedPos[1], ejectedPos[2]);
                if (testDensity < buffer) {
                    return ejectedPos;
                }
            }
        }
        
        return position;
    }

    private applySoftBallConstraint(position: vec3, moveVec: vec3): vec3 {
        const densityAt = this.densityAt!;
        const buffer = this.isosurfaceBuffer;
        
        const steps = 8;
        const stepSize = vec3.length(moveVec) / steps;
        const moveDir = vec3.normalize(vec3.create(), moveVec);
        
        let currentPos = vec3.clone(position);
        
        for (let i = 0; i < steps; i++) {
            const stepVec = vec3.scale(vec3.create(), moveDir, stepSize);
            currentPos = this.singleStepSoftBall(currentPos, stepVec, densityAt, buffer);
        }
        
        return currentPos;
    }

    private singleStepSoftBall(position: vec3, moveVec: vec3, densityAt: Function, buffer: number): vec3 {
        const targetPos = vec3.add(vec3.create(), position, moveVec);
        const targetDensity = densityAt(targetPos[0], targetPos[1], targetPos[2]);
        
        if (targetDensity < buffer) {
            return targetPos;
        }
        
        const alternatives = this.generateAlternativePaths(position, moveVec);
        
        for (const altPath of alternatives) {
            const altTarget = vec3.add(vec3.create(), position, altPath);
            const altDensity = densityAt(altTarget[0], altTarget[1], altTarget[2]);
            
            if (altDensity < buffer) {
                return altTarget;
            }
        }
        
        return vec3.clone(position);
    }

    private generateAlternativePaths(position: vec3, moveVec: vec3): vec3[] {
        const alternatives: vec3[] = [];
        const moveLength = vec3.length(moveVec);
        const moveDir = vec3.normalize(vec3.create(), moveVec);
        
        const surfaceNormal = this.estimateDensityGradient(position);
        
        const slideDir = vec3.create();
        const normalComponent = vec3.dot(moveDir, surfaceNormal);
        vec3.scaleAndAdd(slideDir, moveDir, surfaceNormal, -normalComponent);
        if (vec3.length(slideDir) > 0.1) {
            vec3.normalize(slideDir, slideDir);
            alternatives.push(vec3.scale(vec3.create(), slideDir, moveLength * 0.8));
        }
        
        const surfaceClimbBias = 0.3;
        const climbDir = vec3.create();
        vec3.copy(climbDir, moveDir);
        vec3.scaleAndAdd(climbDir, climbDir, surfaceNormal, -surfaceClimbBias);
        vec3.normalize(climbDir, climbDir);
        alternatives.push(vec3.scale(vec3.create(), climbDir, moveLength * 0.7));
        
        const surfaceUp = vec3.negate(vec3.create(), surfaceNormal);
        const rightVec = vec3.cross(vec3.create(), moveDir, surfaceUp);
        vec3.normalize(rightVec, rightVec);
        
        const rightAngleDir = vec3.create();
        vec3.lerp(rightAngleDir, moveDir, rightVec, 0.3);
        vec3.normalize(rightAngleDir, rightAngleDir);
        alternatives.push(vec3.scale(vec3.create(), rightAngleDir, moveLength * 0.6));
        
        const leftAngleDir = vec3.create();
        vec3.lerp(leftAngleDir, moveDir, rightVec, -0.3);
        vec3.normalize(leftAngleDir, leftAngleDir);
        alternatives.push(vec3.scale(vec3.create(), leftAngleDir, moveLength * 0.6));
        
        const tangentDir = vec3.cross(vec3.create(), surfaceNormal, rightVec);
        vec3.normalize(tangentDir, tangentDir);
        
        if (vec3.dot(tangentDir, moveDir) < 0) {
            vec3.negate(tangentDir, tangentDir);
        }
        
        vec3.scaleAndAdd(tangentDir, tangentDir, surfaceNormal, -0.2);
        vec3.normalize(tangentDir, tangentDir);
        alternatives.push(vec3.scale(vec3.create(), tangentDir, moveLength * 0.5));
        
        alternatives.push(vec3.scale(vec3.create(), moveDir, moveLength * 0.3));
        alternatives.push(vec3.scale(vec3.create(), moveDir, moveLength * 0.1));
        
        const perpMovement = vec3.scale(vec3.create(), surfaceNormal, -moveLength * 0.5);
        alternatives.push(perpMovement);
        
        return alternatives;
    }

    private estimateDensityGradient(pos: vec3): vec3 {
        const eps = 0.1;
        const densityAt = this.densityAt!;
        const dx = densityAt(pos[0] + eps, pos[1], pos[2]) - densityAt(pos[0] - eps, pos[1], pos[2]);
        const dy = densityAt(pos[0], pos[1] + eps, pos[2]) - densityAt(pos[0], pos[1] - eps, pos[2]);
        const dz = densityAt(pos[0], pos[1], pos[2] + eps) - densityAt(pos[0], pos[1], pos[2] - eps);
        const grad = vec3.fromValues(dx, dy, dz);
        const length = vec3.length(grad);
        if (length > 0.001) {
            vec3.scale(grad, grad, 1.0 / length);
        } else {
            vec3.set(grad, 0, 1, 0);
        }
        return grad;
    }

    public setDensityAt(fn: (x: number, y: number, z: number) => number) {
        this.densityAt = fn;
    }

    updateViewMatrix() {
        const world = mat4.fromRotationTranslation(mat4.create(), this.orientation, this.position);
        mat4.invert(this.viewMatrix, world);
    }

    getForward(): vec3 {
        return vec3.transformQuat(vec3.create(), [0, 0, -1], this.orientation);
    }
    getRight(): vec3 {
        return vec3.transformQuat(vec3.create(), [1, 0, 0], this.orientation);
    }
    getUp(): vec3 {
        return vec3.transformQuat(vec3.create(), [0, 1, 0], this.orientation);
    }
}