export class Shader {
    public program: WebGLProgram;
    public uniforms: { [name: string]: WebGLUniformLocation | null } = {};

    constructor(gl: WebGL2RenderingContext, vertexSrc: string, fragmentSrc: string) {
        this.program = compileShader(gl, vertexSrc, fragmentSrc);

        const regexUniform = /uniform[^;]+[ ](\w+);/g;
        const matchUniformName = /uniform[^;]+[ ](\w+);/;

        let vertexUnifs = vertexSrc.match(regexUniform);
        let fragUnifs = fragmentSrc.match(regexUniform);

        if (vertexUnifs) {
            vertexUnifs.forEach(unif => {
                const m = unif.match(matchUniformName);
                if (m) this.uniforms[m[1]] = null;
            });
        }
        if (fragUnifs) {
            fragUnifs.forEach(unif => {
                const m = unif.match(matchUniformName);
                if (m) this.uniforms[m[1]] = null;
            });
        }

        for (const unif in this.uniforms) {
            this.uniforms[unif] = gl.getUniformLocation(this.program, unif);
        }
    }

    use(gl: WebGL2RenderingContext) {
        gl.useProgram(this.program);
    }
}

export function compileShader(gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram {
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, vert);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
        alert("Vertex shader failed to compile, see console for log");
        //console.log(gl.getShaderInfoLog(vs));
        throw new Error("Vertex shader compile error");
    }

    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, frag);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
        alert("Fragment shader failed to compile, see console for log");
        //console.log(gl.getShaderInfoLog(fs));
        throw new Error("Fragment shader compile error");
    }

    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        alert("Shader failed to link, see console for log");
        //console.log(gl.getProgramInfoLog(program));
        throw new Error("Shader link error");
    }
    return program;
}
