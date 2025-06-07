import initWasm, { MarchingCubes } from "./marching-cubes-wasm/marching_cubes.js";
import { isosurfaceVertShader, isosurfaceFragShader } from "./gl/shader-srcs";
import { Shader } from "./gl/webgl-util";
import { FreeFlyCamera } from "./gl/free-fly-camera";
import { mat4, vec3 } from "gl-matrix";
import { loadTextureArray } from "./gl/texture-loader";
import { PLANET_RADIUS, densityAtSeeded } from "./chunking/density";
import { SkyboxRenderer } from "./gl/skybox-renderer";
import { SunRenderer } from "./gl/sun-renderer";
import { ChunkConfigManager, type WorldGenerationConfig } from "./chunking/chunk-config";
import { UIManager } from "./ui/ui-manager";
import { AudioManager } from "./audio/audio-manager";
import { OctreeChunkManager } from "./chunking/octree-chunk-manager";
import "./style.css";

let WIDTH = window.innerWidth, HEIGHT = window.innerHeight;
const sunDirection: [number, number, number] = [-0.3, -0.8, -0.5];

let marchingCubes: MarchingCubes;
let octreeChunkManager: OctreeChunkManager;
let canvas: HTMLCanvasElement;
let gl: WebGL2RenderingContext | null = null;
let camera: FreeFlyCamera;
let proj: mat4;
let projView: mat4;
let lastFrameTime = performance.now();
let lastRenderTime = performance.now();
let frameCount = 0;
let fps = 0;

let skyboxRenderer: SkyboxRenderer;
let sunRenderer: SunRenderer;
let uiManager: UIManager;
let audioManager: AudioManager;
let hasUserInteracted = false;

let materialDiffuseArray: WebGLTexture | null = null;
let materialNormalArray: WebGLTexture | null = null;
let materialRoughnessArray: WebGLTexture | null = null;

function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    WIDTH = Math.round(window.innerWidth * dpr);
    HEIGHT = Math.round(window.innerHeight * dpr);
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    if (gl) {
        gl.viewport(0, 0, WIDTH, HEIGHT);
        proj = mat4.perspective(mat4.create(), 60 * Math.PI / 180.0, WIDTH / HEIGHT, 0.1, 100);
        if (camera) {
            camera.aspect = WIDTH / HEIGHT;
            camera.projectionMatrix = mat4.perspective(mat4.create(), camera.fovy, camera.aspect, camera.near, camera.far);
        }
    }
}

function createWebGLContext(): WebGL2RenderingContext | null {
    let context: WebGL2RenderingContext | null = null;
    try {
        context = canvas.getContext("webgl2", {antialias: true}) as WebGL2RenderingContext;
    } catch (error) {
        return null;
    }
    return context;
}

let surfaceShader: Shader;

function setupGL() {
    canvas = document.getElementById("glcanvas") as HTMLCanvasElement;
    gl = createWebGLContext();
    if (!gl) return;
    resizeCanvas();

    const configManager = ChunkConfigManager.getInstance();
    const seed = configManager.getSeed();
    const isoLevelBias = configManager.getIsoLevelBias();
    const restrictToIsosurface = uiManager.getCurrentConfig().enableCollision;
    camera = new FreeFlyCamera(
        WIDTH / HEIGHT,
        Math.PI / 3,
        0.03,
        10000,
        [0, 0, PLANET_RADIUS * 1.3],
        [0, 0, 0],
        [0, 1, 0],
        {
            restrictToIsosurface: restrictToIsosurface,
            isosurfaceBuffer: -0.5,
            densityAt: (x, y, z) => densityAtSeeded(x, y, z, seed, isoLevelBias),
        }
    );
    camera.attach(canvas);

    proj = mat4.perspective(mat4.create(), 60 * Math.PI / 180.0, WIDTH / HEIGHT, 0.1, 1000);
    projView = mat4.create();

    surfaceShader = new Shader(gl, isosurfaceVertShader, isosurfaceFragShader);
    skyboxRenderer = new SkyboxRenderer(gl);

    sunRenderer = new SunRenderer(gl);
    sunRenderer.setSunDirection(vec3.fromValues(...sunDirection));
    sunRenderer.sunSize = 160.0;
    sunRenderer.sunIntensity = 1.4;
    vec3.set(sunRenderer.sunColor, 1.0, 0.0, 0.0);

    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.viewport(0, 0, WIDTH, HEIGHT);

    window.addEventListener('resize', resizeCanvas);
}

function render() {
    if (!gl) return;

    const currentTime = performance.now();
    const deltaTime = Math.min((currentTime - lastRenderTime) / 1000.0, 1/30);
    lastRenderTime = currentTime;

    camera.update(deltaTime);

    mat4.mul(projView, camera.projectionMatrix, camera.viewMatrix);
    const eye = camera.position;
    gl.viewport(0, 0, WIDTH, HEIGHT);

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (skyboxRenderer && skyboxRenderer.isReady()) {
        skyboxRenderer.render(camera.viewMatrix, camera.projectionMatrix);
    }

    if (sunRenderer) {
        const sunToCamera = vec3.create();
        vec3.subtract(sunToCamera, camera.position, sunRenderer.sunPosition);
        vec3.normalize(sunToCamera, sunToCamera);

        const camUp = camera.getUp();
        const projUp = vec3.create();
        const dot = vec3.dot(camUp, sunToCamera);
        vec3.scaleAndAdd(projUp, camUp, sunToCamera, -dot);
        vec3.normalize(projUp, projUp);

        const right = vec3.create();
        vec3.cross(right, projUp, sunToCamera);
        vec3.normalize(right, right);

        const worldUp = vec3.fromValues(0, 1, 0);
        let rollAngle = Math.atan2(
            vec3.dot(right, worldUp),
            vec3.dot(projUp, worldUp)
        );

        sunRenderer.render(
            camera.viewMatrix,
            camera.projectionMatrix,
            right,
            projUp,
            currentTime * 0.001,
            rollAngle
        );
    }

    surfaceShader.use(gl);

    if (materialDiffuseArray && materialNormalArray && materialRoughnessArray) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, materialDiffuseArray);
        if (surfaceShader.uniforms["material_diffuse"]) {
            gl.uniform1i(surfaceShader.uniforms["material_diffuse"], 0);
        }

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, materialNormalArray);
        if (surfaceShader.uniforms["material_normals"]) {
            gl.uniform1i(surfaceShader.uniforms["material_normals"], 1);
        }

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, materialRoughnessArray);
        if (surfaceShader.uniforms["material_roughness"]) {
            gl.uniform1i(surfaceShader.uniforms["material_roughness"], 2);
        }
    }

    const normalizedSunDir = vec3.normalize(vec3.create(), sunDirection);
    const config = uiManager.getCurrentConfig();

    octreeChunkManager.update([eye[0], eye[1], eye[2]], projView);
    octreeChunkManager.renderAll(gl, surfaceShader, projView, [eye[0], eye[1], eye[2]], {
        sun_direction: normalizedSunDir,
        tint_lod_levels: config.tintLODLevels,
        enable_triplanar: config.enableTriplanar
    });

    uiManager.updateInfoPanel();
}

function animationLoop() {
    frameCount++;
    let now = performance.now();
    if (now - lastFrameTime > 1000) {
        fps = frameCount / ((now - lastFrameTime) / 1000);
        uiManager.updateFPS(fps);
        lastFrameTime = now;
        frameCount = 0;
    }
    render();
    requestAnimationFrame(animationLoop);
}

async function regenerateWorld() {
    if (octreeChunkManager) octreeChunkManager.cleanup();

    const config = uiManager.getCurrentConfig();
    const worldGenConfig: WorldGenerationConfig = {
        seed: config.seed,
        voxelResolution: config.voxelResolution,
        numLODLevels: config.numLODLevels,
        rootSizeMultiplier: config.rootSizeMultiplier,
        zBiasFactor: config.zBiasFactor,
        isoLevelBias: config.isoLevelBias,
        fadeOverlapFactor: config.fadeOverlapFactor,
        maxChunks: config.maxChunks,
        maxWorkers: config.maxWorkers,
        lodDistanceFactor: config.lodDistanceFactor
    };
    const configManager = ChunkConfigManager.createWorld(worldGenConfig);
    configManager.setZBiasFactor(config.zBiasFactor);
    configManager.setIsoLevelBias(config.isoLevelBias);
    configManager.setSeed(config.seed);

    if (hasUserInteracted && audioManager) {
        audioManager.setSeed(config.seed);
    }

    if (gl) {
        if (config.backfaceCulling) {
            gl.enable(gl.CULL_FACE);
        } else {
            gl.disable(gl.CULL_FACE);
        }
    }

    octreeChunkManager = new OctreeChunkManager(marchingCubes, gl!, surfaceShader, {
        sun_direction: vec3.normalize(vec3.create(), sunDirection),
        tint_lod_levels: config.tintLODLevels,
        enable_triplanar: config.enableTriplanar
    });

    octreeChunkManager.onConfigChanged();

    if (camera) {
        const seed = configManager.getSeed();
        const isoLevelBias = configManager.getIsoLevelBias();
        camera.setDensityAt((x, y, z) => densityAtSeeded(x, y, z, seed, isoLevelBias));
    }
    camera.setRestrictToIsosurface(uiManager.getCurrentConfig().enableCollision);
    uiManager.setChunkManager(octreeChunkManager);
}

window.onload = async function() {
    uiManager = new UIManager();
    audioManager = new AudioManager();

    uiManager.setOnBackfaceCullingToggledCallback((enabled: boolean) => {
        if (gl) {
            if (enabled) {
                gl.enable(gl.CULL_FACE);
            } else {
                gl.disable(gl.CULL_FACE);
            }
        }
    });

    uiManager.setOnVolumeChangeCallback((volume: number) => {
        if (audioManager) {
            audioManager.setVolume(volume);
        }
    });

    uiManager.setOnCollisionToggledCallback((enabled: boolean) => {
        if (camera) {
            camera.setRestrictToIsosurface(enabled);
        }
    });

    uiManager.setOnRegenerateCallback(async () => {
        await regenerateWorld();
        const config = uiManager.getCurrentConfig();
        if (audioManager) {
            audioManager.setSeed(config.seed);
        }
    });

    const startAudioOnInteraction = async () => {
        if (!hasUserInteracted) {
            hasUserInteracted = true;
            const config = uiManager.getCurrentConfig();
            await audioManager.initialize(config.seed);
            await audioManager.startMusic();
            document.removeEventListener('click', startAudioOnInteraction);
            document.removeEventListener('touchstart', startAudioOnInteraction);
            document.removeEventListener('keydown', startAudioOnInteraction);
        }
    };

    document.addEventListener('click', startAudioOnInteraction);
    document.addEventListener('touchstart', startAudioOnInteraction);
    document.addEventListener('keydown', startAudioOnInteraction);

    await initWasm();
    marchingCubes = new MarchingCubes();
    setupGL();

    await skyboxRenderer.loadSkybox();
    lastRenderTime = performance.now();

    try {
        materialDiffuseArray = await loadTextureArray(gl!, [
            'textures/rock_diff.jpg',
            'textures/grass_diff.jpg', 
            'textures/dirt_diff.jpg',
            'textures/sand_diff.jpg'
        ]);
        materialNormalArray = await loadTextureArray(gl!, [
            'textures/rock_norm.jpg',
            'textures/grass_norm.jpg', 
            'textures/dirt_norm.jpg',
            'textures/sand_norm.jpg'
        ]);
        materialRoughnessArray = await loadTextureArray(gl!, [
            'textures/rock_rough.jpg',
            'textures/grass_rough.jpg', 
            'textures/dirt_rough.jpg',
            'textures/sand_rough.jpg'
        ]);
    } catch (e) {}

    await regenerateWorld();
    uiManager.setChunkManager(octreeChunkManager);

    window.addEventListener('beforeunload', () => {
        if (octreeChunkManager) octreeChunkManager.cleanup();
        if (sunRenderer) sunRenderer.cleanup();
        if (audioManager) audioManager.cleanup();
    });

    animationLoop();
};