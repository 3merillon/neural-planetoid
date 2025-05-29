/* tslint:disable */
/* eslint-disable */
export class MarchingCubes {
  free(): void;
  constructor();
  set_volume(volume: Uint8Array, dims_x: number, dims_y: number, dims_z: number): void;
  /**
   * Marching Cubes: Output indexed mesh with deduplicated positions only (no normals)
   */
  marching_cubes_indexed_pos(isovalue: number): object;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_marchingcubes_free: (a: number, b: number) => void;
  readonly marchingcubes_new: () => number;
  readonly marchingcubes_set_volume: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly marchingcubes_marching_cubes_indexed_pos: (a: number, b: number) => any;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_export_2: WebAssembly.Table;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
