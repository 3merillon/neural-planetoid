import { Chunk } from "./chunk";
import { MarchingCubes } from "../marching-cubes-wasm/marching_cubes";
import { computeNormalsFieldGradientJS } from "./field-gradient";
import { mat4, vec3 } from "gl-matrix";
import { ChunkConfigManager, type LODLevel, type WorldLODConfig } from "./chunk-config";
import { WorkerManager } from "./worker-manager";
import { ChunkPool } from "./chunk-pool";
import { Frustum, createAABBForChunk, FrustumResult } from "./frustum-culling";
import { MaterialSystem, type MaterialWeights } from "./material-system";

function chunkKey(x: number, y: number, z: number, worldSize: number): string {
  return `${x},${y},${z},${worldSize}`;
}

interface ChunkRequest {
  chunkX: number;
  chunkY: number;
  chunkZ: number;
  worldSize: number;
  lodLevel: number;
  priority: number;
  distance: number;
}

export class ChunkManager {
  private configManager: ChunkConfigManager;
  private workerManager: WorkerManager;
  private chunkPool: ChunkPool;
  private frustum: Frustum;
  private lastRenderStats = { emptyChunks: 0, renderedChunks: 0 };

  public chunks = new Map<string, Chunk>();
  private pending = new Set<string>();
  private tempNeeded = new Set<string>();

  private offsetCache = new Map<number, Array<{dx:number,dy:number,dz:number,gridDist:number,euclidDist:number}>>();

  constructor(
    public marchingCubes: MarchingCubes,
    public gl: WebGL2RenderingContext,
    public shader: any,
    public uniforms: any
  ) {
    this.configManager = ChunkConfigManager.getInstance();
    const cfg = this.configManager.getConfig();
    this.workerManager = new WorkerManager(cfg.maxWorkers);
    this.chunkPool = new ChunkPool(cfg.maxChunks);
    this.frustum = new Frustum();
  }

  private worldToChunk(x:number, y:number, z:number, worldSize:number):[number,number,number] {
    return [ Math.floor(x/worldSize), Math.floor(y/worldSize), Math.floor(z/worldSize) ];
  }

  private getOffsets(radius:number) {
    let arr = this.offsetCache.get(radius);
    if (arr) return arr;
    arr = [];
    for(let dz=-radius; dz<=radius; dz++){
      for(let dy=-radius; dy<=radius; dy++){
        for(let dx=-radius; dx<=radius; dx++){
          const gridDist = Math.max(Math.abs(dx),Math.abs(dy),Math.abs(dz));
          const euclidDist = Math.hypot(dx,dy,dz);
          arr.push({dx,dy,dz,gridDist,euclidDist});
        }
      }
    }
    arr.sort((a,b)=> a.gridDist - b.gridDist || a.euclidDist - b.euclidDist);
    this.offsetCache.set(radius, arr);
    return arr;
  }

  private dispatchBuckets(buckets: ChunkRequest[][]) {
    for (let lod = 0; lod < buckets.length; lod++) {
      for (const req of buckets[lod]) {
        if (this.workerManager.getStats().availableWorkers === 0) return;
        const key = chunkKey(req.chunkX, req.chunkY, req.chunkZ, req.worldSize);
        if (!this.chunks.has(key) && !this.pending.has(key)) {
          this.pending.add(key);
          const lodCfg = this.configManager.getLODLevel(req.lodLevel)!;
          this.generateChunkAsync(req.chunkX, req.chunkY, req.chunkZ, lodCfg);
        }
      }
    }
  }

  update(cameraPos: [number,number,number], projectionViewMatrix?: mat4) {
    const cfg = this.configManager.getConfig();
    if (projectionViewMatrix) {
      this.frustum.updateFromMatrix(projectionViewMatrix);
    }

    // Clear pool usage and tempNeeded
    this.chunkPool.setCameraPosition(cameraPos);
    for (const c of this.chunks.values()) {
      this.chunkPool.markNotInUse(c.chunkX, c.chunkY, c.chunkZ, c.worldSize);
    }
    this.tempNeeded.clear();

    // Prepare buckets - dynamic based on actual LOD count
    const numLODs = cfg.lodLevels.length;
    const visibleBuckets    = Array.from({ length: numLODs }, ()=>[] as ChunkRequest[]);
    const backgroundBuckets = Array.from({ length: numLODs }, ()=>[] as ChunkRequest[]);

    // Hierarchical culling bookkeeping
    const culledRegions: {[lvl:number]:Set<string>} = {};
    const sortedLODs = [...cfg.lodLevels].sort((a,b)=>b.level - a.level);
    for (const lodCfg of sortedLODs) {
      culledRegions[lodCfg.level] = new Set<string>();
      this.processLODLevel(cameraPos, lodCfg, culledRegions, visibleBuckets, backgroundBuckets);
    }

    // Dispatch
    this.dispatchBuckets(visibleBuckets);
    if (this.workerManager.getStats().availableWorkers > 0) {
      this.dispatchBuckets(backgroundBuckets);
    }

    this.updateActiveChunks();
  }

  private processLODLevel(
    cameraPos: [number, number, number],
    lod: LODLevel,
    culledRegions: { [lvl: number]: Set<string> },
    visB: ChunkRequest[][],
    backB: ChunkRequest[][]
    ) {
    const cfg = this.configManager.getConfig();
    const numLODs = cfg.lodLevels.length;
    
    const lvl    = lod.level;
    const parent = lvl + 1;
    const radius = lod.maxDistance;
    const ws     = lod.worldSize;

    // Camera in chunk coords, aligned to grid
    const [cx, cy, cz] = this.worldToChunk(cameraPos[0], cameraPos[1], cameraPos[2], ws);
    const scale = lod.gridAlignment / ws;
    const ax = Math.floor(cx * ws / lod.gridAlignment) * scale;
    const ay = Math.floor(cy * ws / lod.gridAlignment) * scale;
    const az = Math.floor(cz * ws / lod.gridAlignment) * scale;

    const offsets = this.getOffsets(radius);

    for (const off of offsets) {
        const x   = Math.round(ax + off.dx * scale);
        const y   = Math.round(ay + off.dy * scale);
        const z   = Math.round(az + off.dz * scale);
        const key = chunkKey(x, y, z, ws);

        // 1) Keep alive in pool
        this.tempNeeded.add(key);

        // 2) Skip generation _only_ if outside view radius (world units)
        const centerX = (x + 0.5) * ws;
        const centerY = (y + 0.5) * ws;
        const centerZ = (z + 0.5) * ws;
        const dx = centerX - cameraPos[0];
        const dy = centerY - cameraPos[1];
        const dz = centerZ - cameraPos[2];
        const centerDist = Math.hypot(dx, dy, dz);
        if (centerDist > lod.maxDistance * ws * 1.1) { //10% buffer to generate chunk before it starts fading in
        continue;
        }

        // 3) Hierarchical skip if parent LOD was outside
        if (parent in culledRegions) {
        const pSize = this.configManager.getLODLevel(parent)!.worldSize;
        const px = Math.floor((x * ws) / pSize);
        const py = Math.floor((y * ws) / pSize);
        const pz = Math.floor((z * ws) / pSize);
        const pKey = chunkKey(px, py, pz, pSize);
        if (culledRegions[parent].has(pKey)) {
            continue;
        }
        }

        // 4) Re-activate pool if already loaded or pending
        if (this.chunks.has(key) || this.pending.has(key)) {
        const pooled = this.chunkPool.getChunk(x, y, z, ws);
        if (pooled) {
            this.chunks.set(key, pooled);
            this.chunkPool.markInUse(x, y, z, ws);
        }
        continue;
        }

        // 5) Frustum‐cull
        const aabb = createAABBForChunk(x, y, z, ws);
        const res  = this.frustum.testAABB(aabb);
        const isVisible = res !== FrustumResult.OUTSIDE;
        if (!isVisible) {
        culledRegions[lvl].add(key);
        }

        // 6) Build the chunk request with dynamic priority calculation
        const maxPriority = 100000;
        const basePri = isVisible
        ? (lvl === 0 ? maxPriority : Math.max(1000, maxPriority / Math.pow(2, lvl)))
        : (lvl === 0 ? maxPriority / 10 : Math.max(100, maxPriority / Math.pow(2, lvl + 3)));
        
        const penalty = Math.min(centerDist * (isVisible ? 10 : 5),
                                isVisible ? 5000 : 2500);
        const priority = basePri - penalty;

        const req: ChunkRequest = {
        chunkX: x,
        chunkY: y,
        chunkZ: z,
        worldSize: ws,
        lodLevel: lvl,
        priority,
        distance: centerDist
        };

        if (isVisible) {
        visB[lvl].push(req);
        } else {
        backB[lvl].push(req);
        }
    }
  }

  private updateActiveChunks() {
    for (const key of this.chunks.keys()) {
      if (!this.tempNeeded.has(key)) {
        const c = this.chunks.get(key)!;
        this.chunkPool.markNotInUse(c.chunkX, c.chunkY, c.chunkZ, c.worldSize);
        this.chunks.delete(key);
      }
    }
    for (const key of this.tempNeeded) {
      const c = this.chunks.get(key);
      if (c) this.chunkPool.markInUse(c.chunkX, c.chunkY, c.chunkZ, c.worldSize);
    }
  }

  // Worker‐backed chunk generation
  private async generateChunkAsync(
    chunkX:number, chunkY:number, chunkZ:number, lodLevel:LODLevel
  ) {
    const cfg  = this.configManager.getConfig();
    const seed = this.configManager.getSeed();
    const iso  = this.configManager.getIsoLevelBias() + lodLevel.isoOffset;

    try {
      const res = await this.workerManager.generateChunk(
        chunkX,chunkY,chunkZ, lodLevel.worldSize, cfg.voxelGridSize,
        lodLevel.level, iso, seed
      );
      if (res.type==='complete' && res.volume) {
        const chunk = new Chunk(
          chunkX,chunkY,chunkZ,
          lodLevel.worldSize, lodLevel.level,
          lodLevel.color, lodLevel.fadeNear,
          lodLevel.fadeFar, lodLevel.zBias
        );
        chunk.state = "generating";
        this.processChunkVolume(chunk, res.volume, res.voxelGridSize!, lodLevel);
        this.chunkPool.addChunk(chunk);
        const key = chunkKey(chunkX,chunkY,chunkZ,lodLevel.worldSize);
        if (this.tempNeeded.has(key)) {
          this.chunks.set(key, chunk);
          this.chunkPool.markInUse(chunkX,chunkY,chunkZ,lodLevel.worldSize);
        }
      }
    } catch (e) {
      console.error("Worker error", e);
    } finally {
      const key = chunkKey(chunkX,chunkY,chunkZ,lodLevel.worldSize);
      this.pending.delete(key);
    }
  }

  // Marching‐cubes + GL setup
  private processChunkVolume(
    chunk: Chunk,
    volume: Uint8Array,
    voxelGridSize: number,
    lodLevel: LODLevel
  ) {
    try {
        this.marchingCubes.set_volume(volume, voxelGridSize+1, voxelGridSize+1, voxelGridSize+1);
        const mesh = this.marchingCubes.marching_cubes_indexed_pos(0.5);
        const positions = Reflect.get(mesh, "vertices") as Float32Array;
        const indices = Reflect.get(mesh, "indices") as Uint32Array;
        
        // Handle empty chunks efficiently
        if (!positions || positions.length === 0 || !indices || indices.length === 0) {
            chunk.isEmpty = true;
            chunk.state = "ready";
            // Don't call setupGL - no resources to allocate
            return;
        }
        
        const [ox, oy, oz] = chunk.getWorldOrigin();
        const vsize = lodLevel.worldSize / voxelGridSize;

        // World-position + normals
        const worldPos = new Float32Array(positions.length);
        for(let i = 0; i < positions.length; i += 3) {
            worldPos[i] = positions[i] * vsize + ox;
            worldPos[i+1] = positions[i+1] * vsize + oy;
            worldPos[i+2] = positions[i+2] * vsize + oz;
        }
        
        const seed = this.configManager.getSeed();
        const iso = this.configManager.getIsoLevelBias() + lodLevel.isoOffset;
        const normals = computeNormalsFieldGradientJS(
            worldPos, seed, iso, 0.5 * vsize
        );

        // Calculate material data for each vertex
        const materialWeights: MaterialWeights[] = [];
        const numVertices = worldPos.length / 3;
        
        for (let i = 0; i < numVertices; i++) {
            const vertexIndex = i * 3;
            const worldPosition: [number, number, number] = [
                worldPos[vertexIndex],
                worldPos[vertexIndex + 1],
                worldPos[vertexIndex + 2]
            ];
            
            const worldNormal: [number, number, number] = [
                normals[vertexIndex],
                normals[vertexIndex + 1],
                normals[vertexIndex + 2]
            ];

            // Calculate material weights using the cleaned up logic
            const weights = MaterialSystem.calculateMaterialWeights(worldPosition, worldNormal);
            materialWeights.push(weights);
        }

        // Interleave position and normal data
        const inter = new Float32Array((worldPos.length / 3) * 6);
        for(let i = 0, j = 0; i < worldPos.length; i += 3, j += 6) {
            inter[j] = worldPos[i];
            inter[j+1] = worldPos[i+1];
            inter[j+2] = worldPos[i+2];
            inter[j+3] = normals[i];
            inter[j+4] = normals[i+1];
            inter[j+5] = normals[i+2];
        }
        
        chunk.meshVertices = inter;
        chunk.meshIndices = indices;
        chunk.setMaterialData(materialWeights);
        chunk.isEmpty = false;
        
        chunk.state = "ready";
        chunk.setupGL(this.gl, this.shader);
    } catch(e) {
        chunk.state = "error";
        console.error("Chunk process error", e);
    }
  }

  // Optimized render method
  public renderAll(
    gl: WebGL2RenderingContext,
    shader: any,
    projView: mat4,
    eye: [number,number,number],
    uniforms: any
  ) {
    const cfg = this.configManager.getConfig();
    const ext = {
      ...uniforms,
      enable_dithering: cfg.enableDithering,
      max_lod_level:    cfg.lodLevels.length-1,
      z_bias_factor:    cfg.zBiasFactor
    };

    // Bucket chunks by LOD - only include non-empty chunks
    const buckets: Chunk[][] = Array(cfg.lodLevels.length).fill(null).map(()=>[]);
    let emptyChunks = 0;
    let renderedChunks = 0;
    
    for(const c of this.chunks.values()){
      if(c.state === "ready" && c.lodLevel >= 0 && c.lodLevel < cfg.lodLevels.length){
        if (!c.isEmpty && c.numIndices > 0) {
          buckets[c.lodLevel].push(c);
          renderedChunks++;
        } else {
          emptyChunks++;
        }
      }
    }
    
    // Store stats for debugging
    this.lastRenderStats = { emptyChunks, renderedChunks };
    
    // Draw coarsest→finest (only non-empty chunks)
    for(let lod=buckets.length-1;lod>=0;lod--){
      for(const c of buckets[lod]){
        c.render(gl, shader, projView, eye, ext);
      }
    }
  }

  // Stats
  public getStats() {
    const cfg = this.configManager.getConfig();
    const ws = this.workerManager.getStats();
    const ps = this.chunkPool.getStats();
    let ready = 0, gen = 0, err = 0, empty = 0;
    const lodCounts = new Array(cfg.lodLevels.length).fill(0);

    for(const c of this.chunks.values()){
      if(c.state === "ready") {
        ready++;
        if (c.isEmpty) {
          empty++;
        } else if (c.lodLevel >= 0 && c.lodLevel < cfg.lodLevels.length) {
          lodCounts[c.lodLevel] = (lodCounts[c.lodLevel] || 0) + 1;
        }
      } else if(c.state === "generating") gen++;
      else if(c.state === "error") err++;
    }
    
    return {
      ready, gen, err, empty,
      total: this.chunks.size,
      pending: this.pending.size,
      lodCounts,
      pool: ps,
      workers: ws,
      lastRender: this.lastRenderStats
    };
  }

  // Cleanup
  public cleanup() {
    this.workerManager.terminate();
    this.chunkPool.cleanup(this.gl);
    this.chunks.clear();
    this.pending.clear();
  }
}