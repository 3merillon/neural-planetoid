import { Shader } from "../gl/webgl-util";
import { mat4 } from "gl-matrix";
import type { MaterialWeights } from "./material-system";

export type ChunkState = "empty" | "generating" | "ready" | "error";

export class Chunk {
    public state: ChunkState = "empty";
    public meshVertices: Float32Array | null = null;
    public meshIndices: Uint32Array | null = null;
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
        zBias: number = 0
    ) {
        this.lodLevel = lodLevel;
        this.lodColor = lodColor;
        this.fadeNear = fadeNear;
        this.fadeFar = fadeFar;
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
        // Skip GL setup for empty chunks
        if (this.isEmpty || !this.meshVertices || !this.meshIndices || this.meshIndices.length === 0) {
            this.state = "ready";
            return;
        }
        
        // Clean up existing buffers
        if (this.vao) gl.deleteVertexArray(this.vao);
        if (this.vbo) gl.deleteBuffer(this.vbo);
        if (this.ibo) gl.deleteBuffer(this.ibo);
        if (this.materialVbo) gl.deleteBuffer(this.materialVbo);

        this.vao = gl.createVertexArray();
        this.vbo = gl.createBuffer();
        this.ibo = gl.createBuffer();
        this.materialVbo = gl.createBuffer();
        
        gl.bindVertexArray(this.vao);

        // Setup vertex data (position + normal)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, this.meshVertices, gl.STATIC_DRAW);
        
        // Position attribute (location 0)
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
        
        // Normal attribute (location 1)
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);

        // Setup material data (required for all chunks now)
        if (this.materialData) {
            gl.bindBuffer(gl.ARRAY_BUFFER, this.materialVbo);
            gl.bufferData(gl.ARRAY_BUFFER, this.materialData, gl.STATIC_DRAW);
            
            // Material weights attribute (location 2) - vec4 containing rock, grass, dirt, sand weights
            gl.enableVertexAttribArray(2);
            gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
        } else {
            // Create default material weights (all rock)
            const numVertices = this.meshVertices.length / 6; // 6 floats per vertex (3 pos + 3 normal)
            const defaultMaterialData = new Float32Array(numVertices * 4);
            for (let i = 0; i < numVertices; i++) {
                const offset = i * 4;
                defaultMaterialData[offset] = 1.0;     // rock
                defaultMaterialData[offset + 1] = 0.0; // grass
                defaultMaterialData[offset + 2] = 0.0; // dirt
                defaultMaterialData[offset + 3] = 0.0; // sand
            }
            
            gl.bindBuffer(gl.ARRAY_BUFFER, this.materialVbo);
            gl.bufferData(gl.ARRAY_BUFFER, defaultMaterialData, gl.STATIC_DRAW);
            
            gl.enableVertexAttribArray(2);
            gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
        }

        // Setup indices
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.meshIndices, gl.STATIC_DRAW);

        gl.bindVertexArray(null);
        this.numIndices = this.meshIndices.length;
    }

    render(gl: WebGL2RenderingContext, shader: Shader, projView: mat4, eye: [number,number,number], uniforms: any) {
        // Early exit for empty chunks
        if (this.isEmpty || this.state !== "ready" || !this.vao || this.numIndices === 0) {
            return;
        }
        
        gl.bindVertexArray(this.vao);
        shader.use(gl);

        // Set standard uniforms
        if (shader.uniforms["proj_view"]) {
            gl.uniformMatrix4fv(shader.uniforms["proj_view"], false, projView);
        }
        if (shader.uniforms["lod_color"]) {
            gl.uniform3fv(shader.uniforms["lod_color"], this.lodColor);
        }
        if (shader.uniforms["lod_level"]) {
            gl.uniform1i(shader.uniforms["lod_level"], this.lodLevel);
        }
        if (shader.uniforms["fade_near"]) {
            gl.uniform1f(shader.uniforms["fade_near"], this.fadeNear);
        }
        if (shader.uniforms["fade_far"]) {
            gl.uniform1f(shader.uniforms["fade_far"], this.fadeFar);
        }
        if (shader.uniforms["enable_dithering"]) {
            gl.uniform1i(shader.uniforms["enable_dithering"], uniforms.enable_dithering ? 1 : 0);
        }
        if (shader.uniforms["max_lod_level"]) {
            gl.uniform1i(shader.uniforms["max_lod_level"], uniforms.max_lod_level || 4);
        }
        if (shader.uniforms["z_bias_factor"]) {
            gl.uniform1f(shader.uniforms["z_bias_factor"], uniforms.z_bias_factor || 0.00001);
        }
        if (shader.uniforms["eye_pos"]) {
            gl.uniform3fv(shader.uniforms["eye_pos"], eye);
        }

        // Set other uniforms
        if (shader.uniforms["volume_dims"]) {
            gl.uniform3iv(shader.uniforms["volume_dims"], [this.worldSize, this.worldSize, this.worldSize]);
        }
        if (shader.uniforms["volume_scale"]) {
            gl.uniform3fv(shader.uniforms["volume_scale"], [1,1,1]);
        }
        if (shader.uniforms["use_smooth_shading"]) {
            gl.uniform1i(shader.uniforms["use_smooth_shading"], 1);
        }
        if (shader.uniforms["isovalue"]) {
            gl.uniform1f(shader.uniforms["isovalue"], 0.0);
        }
        
        // Sun direction
        if (shader.uniforms["sun_direction"] && uniforms.sun_direction) {
            gl.uniform3fv(shader.uniforms["sun_direction"], uniforms.sun_direction);
        }
        
        // Control uniforms
        if (shader.uniforms["tint_lod_levels"]) {
            gl.uniform1i(shader.uniforms["tint_lod_levels"], uniforms.tint_lod_levels ? 1 : 0);
        }
        if (shader.uniforms["bump_height"]) {
            gl.uniform1f(shader.uniforms["bump_height"], uniforms.bump_height || 1.0);
        }
        if (shader.uniforms["enable_triplanar"]) {
            gl.uniform1i(shader.uniforms["enable_triplanar"], uniforms.enable_triplanar ? 1 : 0);
        }

        gl.drawElements(gl.TRIANGLES, this.numIndices, gl.UNSIGNED_INT, 0);
        gl.bindVertexArray(null);
    }

    // Set material data for this chunk
    setMaterialData(materialWeights: MaterialWeights[]): void {
        if (!materialWeights || materialWeights.length === 0) {
            this.materialData = null;
            return;
        }

        // Convert material weights to Float32Array (4 floats per vertex: rock, grass, dirt, sand)
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

    // Get memory footprint for pool management
    getMemoryFootprint(): number {
        if (this.isEmpty) return 0;
        
        let size = 0;
        if (this.meshVertices) size += this.meshVertices.byteLength;
        if (this.meshIndices) size += this.meshIndices.byteLength;
        if (this.materialData) size += this.materialData.byteLength;
        return size;
    }

    cleanup(gl: WebGL2RenderingContext): void {
        // Only clean up if we actually allocated resources
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