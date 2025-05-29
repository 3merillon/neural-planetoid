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
