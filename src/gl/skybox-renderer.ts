import { Shader } from "./webgl-util";
import { skyboxVertShader, skyboxFragShader } from "./skybox-shader";
import { mat4 } from "gl-matrix";

export class SkyboxRenderer {
    private gl: WebGL2RenderingContext;
    private shader: Shader;
    private vao: WebGLVertexArrayObject | null = null;
    private vbo: WebGLBuffer | null = null;
    private cubemap: WebGLTexture | null = null;
    private isLoading = false;

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
        this.shader = new Shader(gl, skyboxVertShader, skyboxFragShader);
        this.setupGeometry();
    }

    private setupGeometry(): void {
        const gl = this.gl;

        // Skybox cube vertices - using a larger cube to ensure it's always visible
        const vertices = new Float32Array([
            // Front face
            -1, -1,  1,
             1, -1,  1,
             1,  1,  1,
            -1, -1,  1,
             1,  1,  1,
            -1,  1,  1,

            // Back face
            -1, -1, -1,
            -1,  1, -1,
             1,  1, -1,
            -1, -1, -1,
             1,  1, -1,
             1, -1, -1,

            // Top face
            -1,  1, -1,
            -1,  1,  1,
             1,  1,  1,
            -1,  1, -1,
             1,  1,  1,
             1,  1, -1,

            // Bottom face
            -1, -1, -1,
             1, -1, -1,
             1, -1,  1,
            -1, -1, -1,
             1, -1,  1,
            -1, -1,  1,

            // Right face
             1, -1, -1,
             1,  1, -1,
             1,  1,  1,
             1, -1, -1,
             1,  1,  1,
             1, -1,  1,

            // Left face
            -1, -1, -1,
            -1, -1,  1,
            -1,  1,  1,
            -1, -1, -1,
            -1,  1,  1,
            -1,  1, -1
        ]);

        this.vao = gl.createVertexArray();
        this.vbo = gl.createBuffer();

        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    public async loadSkybox(): Promise<void> {
        if (this.isLoading || this.cubemap) return;
        
        this.isLoading = true;
        //console.log("Loading skybox textures...");

        try {
            const faceUrls = [
                'skybox/skybox_right1.jpg',   // +X (right)
                'skybox/skybox_left2.jpg',    // -X (left)
                'skybox/skybox_top3.jpg',     // +Y (top)
                'skybox/skybox_bottom4.jpg',  // -Y (bottom)
                'skybox/skybox_front5.jpg',   // +Z (front)
                'skybox/skybox_back6.jpg'     // -Z (back)
            ];

            await this.createCubemapFromUrls(faceUrls);
            //console.log("Skybox loaded successfully!");
        } catch (error) {
            //console.error("Failed to load skybox:", error);
            // Create a fallback procedural skybox
            this.createFallbackSkybox();
        } finally {
            this.isLoading = false;
        }
    }

    private async createCubemapFromUrls(urls: string[]): Promise<void> {
        const gl = this.gl;

        // Load all images first
        const images = await Promise.all(urls.map(url => this.loadImage(url)));

        if (this.cubemap) {
            gl.deleteTexture(this.cubemap);
        }

        this.cubemap = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.cubemap);

        // Upload each face in the correct order
        const faces = [
            gl.TEXTURE_CUBE_MAP_POSITIVE_X, // right
            gl.TEXTURE_CUBE_MAP_NEGATIVE_X, // left
            gl.TEXTURE_CUBE_MAP_POSITIVE_Y, // top
            gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, // bottom
            gl.TEXTURE_CUBE_MAP_POSITIVE_Z, // front
            gl.TEXTURE_CUBE_MAP_NEGATIVE_Z  // back
        ];

        for (let i = 0; i < 6; i++) {
            //console.log(`Loading face ${i}: ${urls[i]}`);
            gl.texImage2D(
                faces[i],
                0,
                gl.RGBA,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                images[i]
            );
        }

        // Set texture parameters
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

        gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
    }

    private createFallbackSkybox(): void {
        const gl = this.gl;
        //console.log("Creating fallback procedural skybox...");

        if (this.cubemap) {
            gl.deleteTexture(this.cubemap);
        }

        this.cubemap = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.cubemap);

        // Create a simple gradient skybox
        const size = 256;
        const faces = [
            gl.TEXTURE_CUBE_MAP_POSITIVE_X, // right
            gl.TEXTURE_CUBE_MAP_NEGATIVE_X, // left
            gl.TEXTURE_CUBE_MAP_POSITIVE_Y, // top
            gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, // bottom
            gl.TEXTURE_CUBE_MAP_POSITIVE_Z, // front
            gl.TEXTURE_CUBE_MAP_NEGATIVE_Z  // back
        ];

        const colors = [
            [0.2, 0.1, 0.4], // right - purple
            [0.1, 0.2, 0.4], // left - blue
            [0.1, 0.1, 0.6], // top - dark blue
            [0.0, 0.0, 0.2], // bottom - very dark
            [0.3, 0.1, 0.3], // front - magenta
            [0.1, 0.3, 0.2]  // back - dark green
        ];

        for (let face = 0; face < 6; face++) {
            const data = new Uint8Array(size * size * 4);
            const baseColor = colors[face];
            
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const index = (y * size + x) * 4;
                    
                    // Add some stars
                    const starChance = Math.random();
                    if (starChance > 0.998) {
                        // Bright star
                        data[index] = 255;
                        data[index + 1] = 255;
                        data[index + 2] = 255;
                        data[index + 3] = 255;
                    } else if (starChance > 0.995) {
                        // Dim star
                        data[index] = 128;
                        data[index + 1] = 128;
                        data[index + 2] = 128;
                        data[index + 3] = 255;
                    } else {
                        // Background gradient
                        const gradient = 1.0 - (y / size) * 0.5;
                        data[index] = Math.floor(baseColor[0] * 255 * gradient);
                        data[index + 1] = Math.floor(baseColor[1] * 255 * gradient);
                        data[index + 2] = Math.floor(baseColor[2] * 255 * gradient);
                        data[index + 3] = 255;
                    }
                }
            }

            gl.texImage2D(faces[face], 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
        }

        // Set texture parameters
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

        gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
    }

    private loadImage(url: string): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                //console.log(`Loaded image: ${url} (${img.width}x${img.height})`);
                resolve(img);
            };
            img.onerror = (e) => {
                //console.error(`Failed to load image: ${url}`, e);
                reject(e);
            };
            img.src = url;
        });
    }

    public render(viewMatrix: mat4, projectionMatrix: mat4): void {
        if (!this.cubemap || !this.vao) {
            //console.warn("Skybox not ready for rendering");
            return;
        }

        const gl = this.gl;

        // Save current GL state
        const currentDepthFunc = gl.getParameter(gl.DEPTH_FUNC);
        const currentDepthMask = gl.getParameter(gl.DEPTH_WRITEMASK);
        const currentCullFace = gl.getParameter(gl.CULL_FACE);

        // Set skybox render state
        gl.disable(gl.CULL_FACE);  // Disable culling for skybox
        gl.depthMask(false);       // Don't write to depth buffer
        gl.depthFunc(gl.LEQUAL);   // Allow skybox to render at far plane

        // Use skybox shader
        this.shader.use(gl);

        // Set uniforms
        if (this.shader.uniforms["view_matrix"]) {
            gl.uniformMatrix4fv(this.shader.uniforms["view_matrix"], false, viewMatrix);
        }
        if (this.shader.uniforms["projection_matrix"]) {
            gl.uniformMatrix4fv(this.shader.uniforms["projection_matrix"], false, projectionMatrix);
        }

        // Bind cubemap to texture unit 10 (away from terrain textures)
        gl.activeTexture(gl.TEXTURE10);
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.cubemap);
        if (this.shader.uniforms["skybox"]) {
            gl.uniform1i(this.shader.uniforms["skybox"], 10);
        }

        // Render skybox
        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.TRIANGLES, 0, 36);
        gl.bindVertexArray(null);

        // Restore GL state
        gl.depthMask(currentDepthMask);
        gl.depthFunc(currentDepthFunc);
        if (currentCullFace) {
            gl.enable(gl.CULL_FACE);
        }

        // Clean up texture binding
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
        gl.activeTexture(gl.TEXTURE0); // Reset to default texture unit
    }

    public cleanup(): void {
        const gl = this.gl;
        if (this.vao) gl.deleteVertexArray(this.vao);
        if (this.vbo) gl.deleteBuffer(this.vbo);
        if (this.cubemap) gl.deleteTexture(this.cubemap);
    }

    public isReady(): boolean {
        return this.cubemap !== null && !this.isLoading;
    }
}