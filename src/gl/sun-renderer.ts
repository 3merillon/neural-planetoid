import { Shader } from "./webgl-util";
import { sunVertShader, sunFragShader } from "./sun-shader";
import { mat4, vec3 } from "gl-matrix";

export class SunRenderer {
    private gl: WebGL2RenderingContext;
    private shader: Shader;
    private vao: WebGLVertexArrayObject | null = null;
    private vbo: WebGLBuffer | null = null;
    private ibo: WebGLBuffer | null = null;

    public sunPosition: vec3 = vec3.fromValues(1000, 800, 500);
    public sunColor: vec3 = vec3.fromValues(1.0, 0.0, 0.0); // RED by default
    public sunSize: number = 111.0;
    public sunIntensity: number = 1.4;

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
        this.shader = new Shader(gl, sunVertShader, sunFragShader);
        this.setupGeometry();
    }

    private setupGeometry(): void {
        const gl = this.gl;
        const vertices = new Float32Array([
            -2.0, -2.0,
             2.0, -2.0,
             2.0,  2.0,
            -2.0,  2.0
        ]);
        const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

        this.vao = gl.createVertexArray();
        this.vbo = gl.createBuffer();
        this.ibo = gl.createBuffer();

        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
        gl.bindVertexArray(null);
    }

    public setSunDirection(direction: vec3): void {
        const distance = 2000.0;
        vec3.scale(this.sunPosition, vec3.normalize(vec3.create(), direction), -distance);
    }

    public render(
        viewMatrix: mat4,
        projectionMatrix: mat4,
        cameraRight: vec3,
        cameraUp: vec3,
        time: number,
        rollAngle: number
    ): void {
        if (!this.vao) return;
        const gl = this.gl;

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

        gl.depthMask(false);
        gl.depthFunc(gl.LEQUAL);

        this.shader.use(gl);

        if (this.shader.uniforms["view_matrix"])
            gl.uniformMatrix4fv(this.shader.uniforms["view_matrix"], false, viewMatrix);
        if (this.shader.uniforms["projection_matrix"])
            gl.uniformMatrix4fv(this.shader.uniforms["projection_matrix"], false, projectionMatrix);
        if (this.shader.uniforms["sun_world_position"])
            gl.uniform3fv(this.shader.uniforms["sun_world_position"], this.sunPosition);
        if (this.shader.uniforms["sun_color"])
            gl.uniform3fv(this.shader.uniforms["sun_color"], this.sunColor);
        if (this.shader.uniforms["sun_size"])
            gl.uniform1f(this.shader.uniforms["sun_size"], this.sunSize);
        if (this.shader.uniforms["sun_intensity"])
            gl.uniform1f(this.shader.uniforms["sun_intensity"], this.sunIntensity);
        if (this.shader.uniforms["camera_right"])
            gl.uniform3fv(this.shader.uniforms["camera_right"], cameraRight);
        if (this.shader.uniforms["camera_up"])
            gl.uniform3fv(this.shader.uniforms["camera_up"], cameraUp);
        if (this.shader.uniforms["time"])
            gl.uniform1f(this.shader.uniforms["time"], time);
        if (this.shader.uniforms["billboard_roll"])
            gl.uniform1f(this.shader.uniforms["billboard_roll"], rollAngle);

        gl.bindVertexArray(this.vao);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
        gl.bindVertexArray(null);

        gl.depthMask(true);
        gl.disable(gl.BLEND);
    }

    public cleanup(): void {
        const gl = this.gl;
        if (this.vao) gl.deleteVertexArray(this.vao);
        if (this.vbo) gl.deleteBuffer(this.vbo);
        if (this.ibo) gl.deleteBuffer(this.ibo);
    }
}