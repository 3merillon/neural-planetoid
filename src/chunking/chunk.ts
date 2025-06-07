import { Shader } from "../gl/webgl-util";
import { mat4 } from "gl-matrix";
import type { MaterialWeights } from "./material-system";

export type ChunkState = "empty" | "generating" | "ready" | "error";

export class Chunk {
    public state: ChunkState = "empty";
    public meshVertices: Float32Array | null = null;
    public meshIndices: Uint32Array | Uint16Array | null = null;
    public materialData: Float32Array | null = null;
    public vao: WebGLVertexArrayObject | null = null;
    public vbo: WebGLBuffer | null = null;
    public ibo: WebGLBuffer | null = null;
    public materialVbo: WebGLBuffer | null = null;
    public numIndices: number = 0;
    public lodLevel: number = 0;
    public lodColor: [number, number, number] = [1, 1, 1];
    public fadeNear: number = 1000;
    public fadeFar: number = 1200;
    public fadeInStart: number = 0;
    public fadeInEnd: number = 0;
    public fadeOutStart: number = 1000;
    public fadeOutEnd: number = 1200;
    public zBias: number = 0;
    public isEmpty: boolean = false;

    constructor(
        public chunkX: number,
        public chunkY: number,
        public chunkZ: number,
        public worldSize: number,
        lodLevel: number = 0,
        lodColor: [number, number, number] = [1, 1, 1],
        fadeNear: number = 1000,
        fadeFar: number = 1200,
        zBias: number = 0,
        fadeInStart: number = 0,
        fadeInEnd: number = 0,
        fadeOutStart: number = 1000,
        fadeOutEnd: number = 1200
    ) {
        this.lodLevel = lodLevel;
        this.lodColor = lodColor;
        this.fadeNear = fadeNear;
        this.fadeFar = fadeFar;
        this.fadeInStart = fadeInStart;
        this.fadeInEnd = fadeInEnd;
        this.fadeOutStart = fadeOutStart;
        this.fadeOutEnd = fadeOutEnd;
        this.zBias = zBias;
    }

    getWorldOrigin(): [number, number, number] {
        return [
            this.chunkX * this.worldSize,
            this.chunkY * this.worldSize,
            this.chunkZ * this.worldSize
        ];
    }

    setupGL(gl: WebGL2RenderingContext, shader: Shader) {
        if (this.isEmpty || !this.meshVertices || !this.meshIndices || this.meshIndices.length === 0) {
            this.state = "ready";
            return;
        }
        if (this.vao) gl.deleteVertexArray(this.vao);
        if (this.vbo) gl.deleteBuffer(this.vbo);
        if (this.ibo) gl.deleteBuffer(this.ibo);
        if (this.materialVbo) gl.deleteBuffer(this.materialVbo);

        this.vao = gl.createVertexArray();
        this.vbo = gl.createBuffer();
        this.ibo = gl.createBuffer();
        this.materialVbo = gl.createBuffer();

        gl.bindVertexArray(this.vao);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, this.meshVertices, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);

        if (this.materialData) {
            gl.bindBuffer(gl.ARRAY_BUFFER, this.materialVbo);
            gl.bufferData(gl.ARRAY_BUFFER, this.materialData, gl.STATIC_DRAW);
            gl.enableVertexAttribArray(2);
            gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
        } else {
            const numVertices = this.meshVertices.length / 6;
            const defaultMaterialData = new Float32Array(numVertices * 4);
            for (let i = 0; i < numVertices; i++) {
                const offset = i * 4;
                defaultMaterialData[offset] = 1.0;
                defaultMaterialData[offset + 1] = 0.0;
                defaultMaterialData[offset + 2] = 0.0;
                defaultMaterialData[offset + 3] = 0.0;
            }
            gl.bindBuffer(gl.ARRAY_BUFFER, this.materialVbo);
            gl.bufferData(gl.ARRAY_BUFFER, defaultMaterialData, gl.STATIC_DRAW);
            gl.enableVertexAttribArray(2);
            gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
        }

        // --- CHUNK INDEX TYPE HANDLING ---
        const maxIndex = this.meshIndices ? Math.max(...this.meshIndices) : 0;
        const useShort = (this.meshVertices.length / 6) < 65536 && maxIndex < 65536;

        if (useShort && !(this.meshIndices instanceof Uint16Array)) {
            this.meshIndices = new Uint16Array(this.meshIndices);
        } else if (!useShort && !(this.meshIndices instanceof Uint32Array)) {
            this.meshIndices = new Uint32Array(this.meshIndices);
        }

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.meshIndices, gl.STATIC_DRAW);

        gl.bindVertexArray(null);
        this.numIndices = this.meshIndices.length;
    }

    render(gl: WebGL2RenderingContext, shader: Shader, projView: mat4, eye: [number,number,number], uniforms: any) {
        if (this.isEmpty || this.state !== "ready" || !this.vao || this.numIndices === 0) {
            return;
        }
        gl.bindVertexArray(this.vao);
        shader.use(gl);

        if (shader.uniforms["proj_view"]) gl.uniformMatrix4fv(shader.uniforms["proj_view"], false, projView);
        if (shader.uniforms["lod_color"]) gl.uniform3fv(shader.uniforms["lod_color"], this.lodColor);
        if (shader.uniforms["lod_level"]) gl.uniform1i(shader.uniforms["lod_level"], this.lodLevel);
        if (shader.uniforms["fade_in_start"]) gl.uniform1f(shader.uniforms["fade_in_start"], this.fadeInStart);
        if (shader.uniforms["fade_in_end"]) gl.uniform1f(shader.uniforms["fade_in_end"], this.fadeInEnd);
        if (shader.uniforms["fade_out_start"]) gl.uniform1f(shader.uniforms["fade_out_start"], this.fadeOutStart);
        if (shader.uniforms["fade_out_end"]) gl.uniform1f(shader.uniforms["fade_out_end"], this.fadeOutEnd);
        if (shader.uniforms["fade_near"]) gl.uniform1f(shader.uniforms["fade_near"], this.fadeNear);
        if (shader.uniforms["fade_far"]) gl.uniform1f(shader.uniforms["fade_far"], this.fadeFar);
        if (shader.uniforms["enable_dithering"]) gl.uniform1i(shader.uniforms["enable_dithering"], uniforms.enable_dithering ? 1 : 0);
        if (shader.uniforms["max_lod_level"]) gl.uniform1i(shader.uniforms["max_lod_level"], uniforms.max_lod_level || 4);
        if (shader.uniforms["z_bias_factor"]) {
            const maxLevel = uniforms.max_lod_level || 4;
            const finestLevel = maxLevel;
            const levelDifference = finestLevel - this.lodLevel;
            
            const zBiasFactor = (uniforms.z_bias_factor !== undefined && uniforms.z_bias_factor !== null) 
                ? uniforms.z_bias_factor 
                : 0.0;
            
            const actualZBias = (this.lodLevel === maxLevel) ? 0.0 : levelDifference * zBiasFactor;
            gl.uniform1f(shader.uniforms["z_bias_factor"], actualZBias);
        }
        if (shader.uniforms["eye_pos"]) gl.uniform3fv(shader.uniforms["eye_pos"], eye);
        if (shader.uniforms["volume_dims"]) gl.uniform3iv(shader.uniforms["volume_dims"], [this.worldSize, this.worldSize, this.worldSize]);
        if (shader.uniforms["volume_scale"]) gl.uniform3fv(shader.uniforms["volume_scale"], [1,1,1]);
        if (shader.uniforms["use_smooth_shading"]) gl.uniform1i(shader.uniforms["use_smooth_shading"], 1);
        if (shader.uniforms["isovalue"]) gl.uniform1f(shader.uniforms["isovalue"], 0.0);
        if (shader.uniforms["sun_direction"] && uniforms.sun_direction) gl.uniform3fv(shader.uniforms["sun_direction"], uniforms.sun_direction);
        if (shader.uniforms["tint_lod_levels"]) gl.uniform1i(shader.uniforms["tint_lod_levels"], uniforms.tint_lod_levels ? 1 : 0);
        if (shader.uniforms["bump_height"]) gl.uniform1f(shader.uniforms["bump_height"], uniforms.bump_height || 1.0);
        if (shader.uniforms["enable_triplanar"]) gl.uniform1i(shader.uniforms["enable_triplanar"], uniforms.enable_triplanar ? 1 : 0);

        const indexType = (this.meshIndices instanceof Uint16Array) ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT;
        gl.drawElements(gl.TRIANGLES, this.numIndices, indexType, 0);
        gl.bindVertexArray(null);
    }

    setMaterialData(materialWeights: MaterialWeights[]): void {
        if (!materialWeights || materialWeights.length === 0) {
            this.materialData = null;
            return;
        }
        this.materialData = new Float32Array(materialWeights.length * 4);
        for (let i = 0; i < materialWeights.length; i++) {
            const weights = materialWeights[i];
            const offset = i * 4;
            this.materialData[offset] = weights.rock;
            this.materialData[offset + 1] = weights.grass;
            this.materialData[offset + 2] = weights.dirt;
            this.materialData[offset + 3] = weights.sand;
        }
    }

    getMemoryFootprint(): number {
        if (this.isEmpty) return 0;
        let size = 0;
        if (this.meshVertices) size += this.meshVertices.byteLength;
        if (this.meshIndices) size += this.meshIndices.byteLength;
        if (this.materialData) size += this.materialData.byteLength;
        return size;
    }

    cleanup(gl: WebGL2RenderingContext): void {
        if (!this.isEmpty) {
            if (this.vao) gl.deleteVertexArray(this.vao);
            if (this.vbo) gl.deleteBuffer(this.vbo);
            if (this.ibo) gl.deleteBuffer(this.ibo);
            if (this.materialVbo) gl.deleteBuffer(this.materialVbo);
        }
        this.vao = null;
        this.vbo = null;
        this.ibo = null;
        this.materialVbo = null;
        this.materialData = null;
    }
}