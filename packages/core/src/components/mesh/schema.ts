import { type GeometryDef } from '../../scene/geometry';
import { type MaterialDef } from '../../scene/material';
import type { ComponentBase, Hex } from '../../scene/primitives';

export interface MeshComponent extends ComponentBase {
  type: 'mesh';
  geometry: GeometryDef;
  /**
   * The embedded material, used while `materialId` is null.
   *
   * Godot's model rather than Unity's: a material starts embedded, and only
   * becomes a shared asset when the author asks for one. Unity and Unreal are
   * asset-first — a new object gets a read-only default and any change forces
   * you to create an asset — which buys consistency at the price of a file per
   * tinted cube.
   */
  material: MaterialDef;
  /**
   * Asset id of a shared material. When set it wins over `material`, and the
   * embedded value is left untouched so detaching can fall back to it.
   */
  materialId: string | null;
  castShadow: boolean;
  receiveShadow: boolean;
}
