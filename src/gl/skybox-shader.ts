export const skyboxVertShader = `#version 300 es
layout(location = 0) in vec3 position;

uniform mat4 view_matrix;
uniform mat4 projection_matrix;

out vec3 tex_coords;

void main() {
    // Remove translation from view matrix for skybox
    mat4 view_no_translation = view_matrix;
    view_no_translation[3][0] = 0.0;
    view_no_translation[3][1] = 0.0;
    view_no_translation[3][2] = 0.0;
    
    vec4 pos = projection_matrix * view_no_translation * vec4(position, 1.0);
    
    // Ensure skybox is always at far plane
    gl_Position = pos.xyww;
    
    // Use position as texture coordinates
    tex_coords = position;
}`;

export const skyboxFragShader = `#version 300 es
precision highp float;

in vec3 tex_coords;
uniform samplerCube skybox;

out vec4 frag_color;

void main() {
    // Sample the cubemap
    vec3 color = texture(skybox, tex_coords).rgb;
    
    // Ensure we have some visible output even if texture fails
    if (length(color) < 0.01) {
        // Fallback: simple gradient based on direction
        float y = tex_coords.y * 0.5 + 0.5;
        color = mix(vec3(0.1, 0.1, 0.2), vec3(0.2, 0.1, 0.4), y);
    }
    
    frag_color = vec4(color, 1.0);
}`;