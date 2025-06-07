export const isosurfaceVertShader = `#version 300 es
layout(location=0) in vec3 pos;
layout(location=1) in vec3 normal;
layout(location=2) in vec4 material_weights;

uniform mat4 proj_view;
uniform int lod_level;
uniform float z_bias_factor;

out vec3 vpos;
out vec3 vnormal;
out vec4 vertex_material_weights;

void main(void) {
    vpos = pos;
    vnormal = normal;
    vertex_material_weights = material_weights;
    
    vec4 clip_pos = proj_view * vec4(pos, 1.0);
    clip_pos.z -= z_bias_factor * clip_pos.w;
    
    gl_Position = clip_pos;
}`;

export const isosurfaceFragShader = `#version 300 es
precision highp float;
precision highp int;

uniform float isovalue;
uniform vec3 eye_pos;
uniform vec3 sun_direction;
uniform bool use_smooth_shading;
uniform vec3 lod_color;
uniform int lod_level;

// Overlapping fade uniforms
uniform float fade_in_start;
uniform float fade_in_end;
uniform float fade_out_start;
uniform float fade_out_end;

// Legacy fade uniforms (for compatibility)
uniform float fade_near;
uniform float fade_far;

uniform int max_lod_level;
uniform highp sampler2DArray material_diffuse;
uniform highp sampler2DArray material_normals;  
uniform highp sampler2DArray material_roughness;
uniform bool tint_lod_levels;
uniform float bump_height;
uniform bool enable_triplanar;

in vec3 vpos;
in vec3 vnormal;
in vec4 vertex_material_weights;

out vec4 color;

vec3 srgb_to_linear(vec3 c) {
    return pow(c, vec3(2.2));
}

vec3 calculate_triplanar_weights(vec3 normal) {
    vec3 abs_normal = abs(normal);
    abs_normal = pow(abs_normal, vec3(4.0));
    float sum = abs_normal.x + abs_normal.y + abs_normal.z;
    return sum > 0.001 ? abs_normal / sum : vec3(0.0, 1.0, 0.0);
}

vec3 triplanar_diffuse_multi(vec3 world_pos, vec3 world_normal, float scale, vec4 material_weights) {
    vec3 blend_weights = calculate_triplanar_weights(world_normal);
    vec3 final_color = vec3(0.0);
    
    for(int i = 0; i < 4; i++) {
        if(material_weights[i] > 0.05) {
            vec3 color_x = texture(material_diffuse, vec3(world_pos.zy * scale, float(i))).rgb;
            vec3 color_y = texture(material_diffuse, vec3(world_pos.xz * scale, float(i))).rgb;
            vec3 color_z = texture(material_diffuse, vec3(world_pos.xy * scale, float(i))).rgb;
            
            vec3 triplanar_result = color_x * blend_weights.x + 
                                   color_y * blend_weights.y + 
                                   color_z * blend_weights.z;
            
            final_color += srgb_to_linear(triplanar_result) * material_weights[i];
        }
    }
    
    return final_color;
}

vec3 triplanar_normal_multi(vec3 world_pos, vec3 world_normal, float scale, vec4 material_weights) {
    vec3 blend_weights = calculate_triplanar_weights(world_normal);
    vec3 final_normal = vec3(0.0);
    
    for(int i = 0; i < 4; i++) {
        if(material_weights[i] > 0.05) {
            vec3 normal_x = texture(material_normals, vec3(world_pos.zy * scale, float(i))).xyz * 2.0 - 1.0;
            vec3 normal_y = texture(material_normals, vec3(world_pos.xz * scale, float(i))).xyz * 2.0 - 1.0;
            vec3 normal_z = texture(material_normals, vec3(world_pos.xy * scale, float(i))).xyz * 2.0 - 1.0;
            
            normal_x.xy *= bump_height;
            normal_y.xy *= bump_height;
            normal_z.xy *= bump_height;
            
            normal_x = normalize(normal_x);
            normal_y = normalize(normal_y);
            normal_z = normalize(normal_z);
            
            vec3 world_normal_x, world_normal_y, world_normal_z;
            
            if (world_normal.x >= 0.0) {
                world_normal_x = vec3(normal_x.z, normal_x.y, normal_x.x);
            } else {
                world_normal_x = vec3(-normal_x.z, normal_x.y, -normal_x.x);
            }
            
            if (world_normal.y >= 0.0) {
                world_normal_y = vec3(normal_y.x, normal_y.z, normal_y.y);
            } else {
                world_normal_y = vec3(normal_y.x, -normal_y.z, -normal_y.y);
            }
            
            if (world_normal.z >= 0.0) {
                world_normal_z = vec3(normal_z.x, normal_z.y, normal_z.z);
            } else {
                world_normal_z = vec3(-normal_z.x, normal_z.y, -normal_z.z);
            }
            
            vec3 blended_normal = world_normal_x * blend_weights.x + 
                                 world_normal_y * blend_weights.y + 
                                 world_normal_z * blend_weights.z;
            
            final_normal += blended_normal * material_weights[i];
        }
    }
    
    return normalize(mix(world_normal, final_normal, 0.8));
}

float triplanar_roughness_multi(vec3 world_pos, vec3 world_normal, float scale, vec4 material_weights) {
    vec3 blend_weights = calculate_triplanar_weights(world_normal);
    float final_roughness = 0.0;
    
    for(int i = 0; i < 4; i++) {
        if(material_weights[i] > 0.05) {
            float roughness_x = texture(material_roughness, vec3(world_pos.zy * scale, float(i))).r;
            float roughness_y = texture(material_roughness, vec3(world_pos.xz * scale, float(i))).r;
            float roughness_z = texture(material_roughness, vec3(world_pos.xy * scale, float(i))).r;
            
            float triplanar_roughness = roughness_x * blend_weights.x + 
                                       roughness_y * blend_weights.y + 
                                       roughness_z * blend_weights.z;
            
            final_roughness += triplanar_roughness * material_weights[i];
        }
    }
    
    return final_roughness;
}

// Dithering matrix for LOD transitions
const mat4 bayerMatrix = mat4(
    0.0/16.0,  8.0/16.0,  2.0/16.0, 10.0/16.0,
    12.0/16.0, 4.0/16.0, 14.0/16.0,  6.0/16.0,
    3.0/16.0, 11.0/16.0,  1.0/16.0,  9.0/16.0,
    15.0/16.0, 7.0/16.0, 13.0/16.0,  5.0/16.0
);

float getBayerValue(ivec2 coord) {
    int x = coord.x % 4;
    int y = coord.y % 4;
    return bayerMatrix[x][y];
}

void main(void) {
    float distance_to_camera = length(eye_pos - vpos);
    
    // NEW: More sophisticated fade logic that allows overlapping
        float dither_threshold = getBayerValue(ivec2(gl_FragCoord.xy));
        bool should_discard = false;
        
        // Validate fade distances
        bool has_valid_fade_in = (fade_in_end > fade_in_start) && (fade_in_start >= 0.0);
        bool has_valid_fade_out = (fade_out_end > fade_out_start) && (fade_out_start > 0.0);
        
        if (lod_level == max_lod_level) {
            // FINEST LOD: Only fades out, allows coarser LODs to show through
            if (has_valid_fade_out && distance_to_camera > fade_out_start) {
                if (distance_to_camera > fade_out_end) {
                    should_discard = true;
                } else {
                    float fade_out_progress = (distance_to_camera - fade_out_start) / (fade_out_end - fade_out_start);
                    float visibility = 1.0 - clamp(fade_out_progress, 0.0, 1.0);
                    
                    // NEW: Use smoother dithering pattern for better transitions
                    float smooth_dither = smoothstep(0.0, 1.0, dither_threshold);
                    if (visibility < smooth_dither) {
                        should_discard = true;
                    }
                }
            }
            
        } else if (lod_level == 0) {
            // COARSEST LOD: Only fades in at far distances
            if (has_valid_fade_in && distance_to_camera < fade_in_end) {
                if (distance_to_camera < fade_in_start) {
                    should_discard = true;
                } else {
                    float fade_in_progress = (distance_to_camera - fade_in_start) / (fade_in_end - fade_in_start);
                    float visibility = clamp(fade_in_progress, 0.0, 1.0);
                    
                    float smooth_dither = smoothstep(0.0, 1.0, dither_threshold);
                    if (visibility < smooth_dither) {
                        should_discard = true;
                    }
                }
            }
            
        } else {
            // MIDDLE LODs: Both fade in and fade out, creating overlap zones
            
            // Fade in logic - becomes visible as camera moves away
            if (has_valid_fade_in && distance_to_camera < fade_in_end) {
                if (distance_to_camera < fade_in_start) {
                    should_discard = true;
                } else {
                    float fade_in_progress = (distance_to_camera - fade_in_start) / (fade_in_end - fade_in_start);
                    float visibility = clamp(fade_in_progress, 0.0, 1.0);
                    
                    float smooth_dither = smoothstep(0.0, 1.0, dither_threshold);
                    if (visibility < smooth_dither) {
                        should_discard = true;
                    }
                }
            }
            
            // Fade out logic - becomes invisible as camera moves further away
            if (!should_discard && has_valid_fade_out && distance_to_camera > fade_out_start) {
                if (distance_to_camera > fade_out_end) {
                    should_discard = true;
                } else {
                    float fade_out_progress = (distance_to_camera - fade_out_start) / (fade_out_end - fade_out_start);
                    float visibility = 1.0 - clamp(fade_out_progress, 0.0, 1.0);
                    
                    float smooth_dither = smoothstep(0.0, 1.0, dither_threshold);
                    if (visibility < smooth_dither) {
                        should_discard = true;
                    }
                }
            }
        }
        
        if (should_discard) discard;

    // Material sampling and lighting
    vec3 base_color;
    vec3 surface_normal;
    float roughness;
    
    if (enable_triplanar) {
        float texture_scale = 0.1;
        base_color = triplanar_diffuse_multi(vpos, normalize(vnormal), texture_scale, vertex_material_weights);
        surface_normal = triplanar_normal_multi(vpos, normalize(vnormal), texture_scale, vertex_material_weights);
        roughness = triplanar_roughness_multi(vpos, normalize(vnormal), texture_scale, vertex_material_weights);
    } else {
        base_color = vec3(0.8);
        surface_normal = normalize(vnormal);
        roughness = 0.5;
    }
    
    if (tint_lod_levels) {
        float tint_strength = 0.25;
        base_color = mix(base_color, lod_color, tint_strength);
    }

    // Lighting calculations
    vec3 view_dir = normalize(eye_pos - vpos);
    vec3 light_dir = -normalize(sun_direction);
    vec3 half_dir = normalize(view_dir + light_dir);
    
    float n_dot_l = max(dot(surface_normal, light_dir), 0.0);
    float n_dot_h = max(dot(surface_normal, half_dir), 0.0);
    float n_dot_v = max(dot(surface_normal, view_dir), 0.0);
    
    vec3 ambient = base_color * 0.01;
    vec3 diffuse = base_color * 0.99 * n_dot_l;
    
    float specular_power = mix(128.0, 4.0, roughness);
    float specular_intensity = mix(0.8, 0.1, roughness);
    
    float fresnel = pow(1.0 - n_dot_v, 2.0);
    float specular_strength = mix(specular_intensity * 0.3, specular_intensity, fresnel);
    vec3 specular = vec3(specular_strength) * pow(n_dot_h, specular_power) * n_dot_l;
    
    vec3 final_color = ambient + diffuse + specular;
    final_color = pow(final_color, vec3(1.0/2.2));
    
    color = vec4(final_color, 1.0);
}`;

export const vertShader = `#version 300 es
#line 4
layout(location=0) in vec3 pos;
uniform mat4 proj_view;
uniform vec3 eye_pos;
uniform vec3 volume_scale;

out vec3 vray_dir;
flat out vec3 transformed_eye;

void main(void) {
	vec3 volume_translation = vec3(0.5) - volume_scale * 0.5;
	gl_Position = proj_view * vec4(pos * volume_scale + volume_translation, 1);
	transformed_eye = (eye_pos - volume_translation) / volume_scale;
	vray_dir = pos - transformed_eye;
}`;

export const fragShader = `#version 300 es
#line 24
precision highp int;
precision highp float;
uniform highp sampler3D volume;
uniform highp sampler2D colormap;
uniform highp sampler2D depth;
uniform ivec3 volume_dims;
uniform float dt_scale;
uniform ivec2 canvas_dims;
uniform vec3 volume_scale;
uniform mat4 inv_view;
uniform mat4 inv_proj;

in vec3 vray_dir;
flat in vec3 transformed_eye;
out vec4 color;

vec2 intersect_box(vec3 orig, vec3 dir) {
	const vec3 box_min = vec3(0);
	const vec3 box_max = vec3(1);
	vec3 inv_dir = 1.0 / dir;
	vec3 tmin_tmp = (box_min - orig) * inv_dir;
	vec3 tmax_tmp = (box_max - orig) * inv_dir;
	vec3 tmin = min(tmin_tmp, tmax_tmp);
	vec3 tmax = max(tmin_tmp, tmax_tmp);
	float t0 = max(tmin.x, max(tmin.y, tmin.z));
	float t1 = min(tmax.x, min(tmax.y, tmax.z));
	return vec2(t0, t1);
}

float wang_hash(int seed) {
	seed = (seed ^ 61) ^ (seed >> 16);
	seed *= 9;
	seed = seed ^ (seed >> 4);
	seed *= 0x27d4eb2d;
	seed = seed ^ (seed >> 15);
	return float(seed % 2147483647) / float(2147483647);
}

float linearize(float d) {
	float near = 0.0;
	float far = 1.0;
	return (2.f * d - near - far) / (far - near);
}

vec4 compute_view_pos(float z) {
	vec4 pos = vec4(gl_FragCoord.xy / vec2(canvas_dims) * 2.f - 1.f, z, 1.f);
	pos = inv_proj * pos;
	return pos / pos.w;
}

void main(void) {
	vec3 ray_dir = normalize(vray_dir);
	vec2 t_hit = intersect_box(transformed_eye, ray_dir);
	if (t_hit.x > t_hit.y) {
		discard;
	}
	t_hit.x = max(t_hit.x, 0.0);

	vec3 dt_vec = 1.0 / (vec3(volume_dims) * abs(ray_dir));
	float dt = dt_scale * min(dt_vec.x, min(dt_vec.y, dt_vec.z));
	float dt_correction = dt_scale;
	float offset = wang_hash(int(gl_FragCoord.x + float(canvas_dims.x) * gl_FragCoord.y));

	float z = linearize(texelFetch(depth, ivec2(gl_FragCoord), 0).x);
	if (z < 1.0) {
		vec3 volume_translation = vec3(0.5) - volume_scale * 0.5;
		vec3 geom_pos = (inv_view * compute_view_pos(z)).xyz;
		geom_pos = (geom_pos - volume_translation) / volume_scale;
		float geom_t = length(geom_pos - transformed_eye);

		float samples = 1.f / dt;
		float newdt = (geom_t - t_hit.x) / samples;
		dt_correction = dt_scale * newdt / dt;
		dt = newdt;
		t_hit.y = geom_t;
	}

	vec3 p = transformed_eye + (t_hit.x + offset * dt) * ray_dir;
	float t;
	for (t = t_hit.x; t < t_hit.y; t += dt) {
		float val = texture(volume, p).r;
		vec4 val_color = vec4(texture(colormap, vec2(val, 0.5)).rgb, val);
		val_color.a = 1.0 - pow(1.0 - val_color.a, dt_correction);
		color.rgb += (1.0 - color.a) * val_color.a * val_color.rgb;
		color.a += (1.0 - color.a) * val_color.a;
		if (color.a >= 0.99) {
			break;
		}
		p += ray_dir * dt;
	}
	if (z < 1.f) {
		p = transformed_eye + t_hit.y * ray_dir;
		float val = texture(volume, p).r;
		vec4 val_color = vec4(texture(colormap, vec2(val, 0.5)).rgb, val);
		val_color.a = 1.0 - pow(1.0 - val_color.a, (t_hit.y - t) * dt_scale);
		color.rgb += (1.0 - color.a) * val_color.a * val_color.rgb;
		color.a += (1.0 - color.a) * val_color.a;
	}
}`;

export const quadVertShader = `#version 300 es
#line 162
const vec4 pos[4] = vec4[4](
	vec4(-1, 1, 0.5, 1),
	vec4(-1, -1, 0.5, 1),
	vec4(1, 1, 0.5, 1),
	vec4(1, -1, 0.5, 1)
);
void main(void){
	gl_Position = pos[gl_VertexID];
}`;

export const quadFragShader = `#version 300 es
#line 175
precision highp int;
precision highp float;

uniform sampler2D colors;
out vec4 color;

float linear_to_srgb(float x) {
	if (x <= 0.0031308f) {
		return 12.92f * x;
	}
	return 1.055f * pow(x, 1.f / 2.4f) - 0.055f;
}

void main(void){ 
	ivec2 uv = ivec2(gl_FragCoord.xy);
	color = texelFetch(colors, uv, 0);
    color.r = linear_to_srgb(color.r);
    color.g = linear_to_srgb(color.g);
    color.b = linear_to_srgb(color.b);
}`;