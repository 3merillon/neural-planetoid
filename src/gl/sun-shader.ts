export const sunVertShader = `#version 300 es
layout(location = 0) in vec2 quadCoord;

uniform mat4 view_matrix;
uniform mat4 projection_matrix;
uniform vec3 sun_world_position;
uniform float sun_size;
uniform vec3 camera_right;
uniform vec3 camera_up;
uniform float billboard_roll;

out vec2 v_texCoord;

void main() {
    vec3 offset = quadCoord.x * camera_right * sun_size + quadCoord.y * camera_up * sun_size;
    vec3 world_pos = sun_world_position + offset;
    gl_Position = projection_matrix * view_matrix * vec4(world_pos, 1.0);

    // Rotated UV
    vec2 uv = quadCoord * 0.5 + 0.5;
    float s = sin(billboard_roll);
    float c = cos(billboard_roll);
    vec2 centered = uv - 0.5;
    vec2 rotated = vec2(
        centered.x * c - centered.y * s,
        centered.x * s + centered.y * c
    );
    v_texCoord = rotated + 0.5;
}
`;

export const sunFragShader = `#version 300 es
precision highp float;

in vec2 v_texCoord;

uniform float time;
uniform vec3 sun_color;
uniform float sun_intensity;

out vec4 frag_color;

// --- Noise Functions ---
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f*f*(3.0-2.0*f);
    return mix(a, b, u.x) +
           (c - a)*u.y*(1.0-u.x) +
           (d - b)*u.x*u.y;
}
float big_fbm(vec2 p) {
    float f = 0.0;
    float w = 0.6;
    for (int i = 0; i < 3; i++) {
        f += w * noise(p);
        p *= 1.7;
        w *= 0.5;
    }
    return f;
}
float fbm(vec2 p) {
    float f = 0.0;
    float w = 0.5;
    for (int i = 0; i < 5; i++) {
        f += w * noise(p);
        p *= 2.0;
        w *= 0.5;
    }
    return f;
}

void main() {
    // Map v_texCoord (0..1) to -1..1
    vec2 uv = v_texCoord * 2.0 - 1.0;
    float dist = length(uv);

    // Discard at far edge
    if (dist > 1.5) discard;

    // Spherical normal for lighting
    float sphere = sqrt(1.0 - clamp(dist, 0.0, 1.0) * clamp(dist, 0.0, 1.0));
    vec3 normal = normalize(vec3(uv, sphere));
    vec3 light_dir = normalize(vec3(-0.4, 0.6, 1.0));
    float diffuse = 0.7 + 0.3 * max(dot(normal, light_dir), 0.0);

    // --- 1. ANIMATED, NOISY CORE WITH WHITE EDGE ---
    float core_radius = 0.98;
    if (dist < core_radius) {
        // Multiple layers of animated noise for rich surface detail
        float surface_noise1 = fbm(uv * 3.0 + time * 0.4);
        float surface_noise2 = fbm(uv * 8.0 - time * 0.2);
        float surface_noise3 = big_fbm(uv * 1.5 + time * 0.1);
        
        // Combine noises for complex surface animation
        float combined_noise = surface_noise1 * 0.5 + surface_noise2 * 0.3 + surface_noise3 * 0.2;
        
        // Animated color variations (reds, oranges, yellows)
        vec3 color1 = mix(sun_color, vec3(1.0, 0.65, 0.15), 0.5); // Base yellow-orange
        vec3 color2 = vec3(1.0, 0.8, 0.1); // Deep orange
        vec3 color3 = vec3(0.8, 0.2, 0.05); // Red-orange
        vec3 color4 = vec3(0.9, 0.85, 0.7); // Bright yellow
        
        // Mix colors based on noise and time
        float color_mix1 = 0.5 + 0.5 * sin(combined_noise * 3.0 + time * 0.3);
        float color_mix2 = 0.5 + 0.5 * sin(surface_noise2 * 4.0 - time * 0.5);
        
        vec3 core_color = mix(color1, color2, color_mix1 * 0.6);
        core_color = mix(core_color, color3, color_mix2 * 0.4);
        core_color = mix(core_color, color4, surface_noise3 * 0.3);
        
        // Animate brightness with noise
        float brightness = 1.0 + 0.15 * combined_noise;
        core_color *= brightness;
        
        // Apply lighting
        core_color = core_color * diffuse * sun_intensity;
        
        // Fade to white at the edge for seamless transition
        float edge_fade = smoothstep(0.95, 1.0, dist);
        core_color = mix(core_color, vec3(1.0, 1.0, 1.0) * sun_intensity * 1.2, edge_fade);
        
        core_color = pow(core_color, vec3(1.0/2.2));
        frag_color = vec4(core_color, 1.0);
        return;
    }

    // --- 2. NOISY YELLOW RING ---
    float ring_inner = core_radius;
    float ring_outer = 0.98;
    // Use low-freq, high-contrast noise for both inner and outer ring boundary
    float ring_noise = big_fbm(uv * 2.0 + time * 0.6);
    // Animate inner and outer boundaries with noise
    float noisy_inner = ring_inner + 0.06 * ring_noise;
    float noisy_outer = ring_outer + 0.09 * ring_noise;

    // Softly fade in/out ring using noisy boundaries
    float ring_alpha = smoothstep(noisy_inner, noisy_inner + 0.08, dist)
                     * (1.0 - smoothstep(noisy_outer, noisy_outer + 0.09, dist));

    // Add some fine detail to the ring
    float detail = fbm(uv * 12.0 - time * 0.3);
    ring_alpha *= 0.9 + 0.4 * detail;

    // Ring color: yellow/orange, modulated by noise, fading to white at edges
    vec3 base_ring_color = mix(vec3(1.0, 0.85, 0.2), vec3(1.0, 0.9, 0.15), 0.7 + 0.3 * ring_noise);
    float ring_edge_fade = smoothstep(0.85, 1.0, ring_alpha);
    vec3 ring_color = mix(base_ring_color, vec3(1.0, 1.0, 1.0), ring_edge_fade * 0.6);
    ring_color = pow(ring_color * diffuse * sun_intensity * 1.15, vec3(1.0/2.2));

    // --- 3. OUTER FLARES WITH WHITE EDGES ---
    float flare_inner = ring_outer + 0.14;
    float flare_outer = 1.18;
    float flare_noise = big_fbm(uv * 1.0 - time * 0.18 + 10.0);
    float noisy_flare_outer = flare_outer + 0.13 * flare_noise;
    float flare_alpha = 1.0 - smoothstep(flare_inner, noisy_flare_outer, dist);

    // Add even more noise for "fingers"
    float flare_fingers = 0.6 + 0.4 * sin(fbm(uv * 3.0 + time * 0.7) * 6.283 + time * 0.2);
    flare_alpha *= flare_fingers;

    // Flare color: blend of orange and core, fading to white at edges
    vec3 base_flare_color = mix(vec3(1.0, 0.7, 0.2), vec3(1.0, 0.85, 0.2), 0.25 + 0.5 * flare_noise);
    float flare_edge_fade = smoothstep(0.3, 1.0, flare_alpha);
    vec3 flare_color = mix(base_flare_color, vec3(1.0, 1.0, 1.0), flare_edge_fade * 0.8);
    flare_color = pow(flare_color * sun_intensity * 0.95, vec3(1.0/2.2));

    // --- 4. COMPOSITE (OPAQUE CENTER, ADDITIVE RING/FLARE) ---
    // Start with fully opaque core behind everything
    vec3 final_color = vec3(1.0, 0.85, 0.2) * diffuse * sun_intensity;
    float final_alpha = 1.0;

    // Add ring color additively (not alpha-blended, so core never becomes translucent)
    if (ring_alpha > 0.01) {
        final_color = mix(final_color, ring_color, clamp(ring_alpha,0.0,1.0));
        // Still opaque!
    }

    // Add flares with soft noisy fade (additively, for extra brightness)
    if (flare_alpha > 0.005 && dist > ring_outer) {
        final_color += flare_color * flare_alpha * 1.1;
        // Still opaque!
    }

    // At the very edge, fade out alpha softly (never in the core or ring)
    if (dist > flare_outer) {
        float edge_fade = smoothstep(1.5, flare_outer, dist);
        final_alpha *= edge_fade;
        if (final_alpha < 0.02) discard;
    }

    frag_color = vec4(final_color, final_alpha);
}
`;