import type { ObjModelSettings } from '../../schema';
import type { TextReader } from '../AssetImporter';
import { CompanionSet, relativeDirname, relativeJoin } from '../companions';
import { field, type ImportField } from '../ImportField';
import { ModelImporter } from './ModelImporter';

/** `map_Kd`, `bump`, `disp`, `decal`, `norm`, `refl` — every map an `.mtl` names. */
const MTL_MAP = /^\s*(?:map_\w+|bump|disp|decal|norm|refl)\s+(.+)$/gm;
const OBJ_LIBRARY = /^\s*mtllib\s+(.+)$/gm;

/**
 * OBJ — what turns up from everywhere else, with an older material model that
 * three approximates.
 *
 * Two levels of reference: the `.obj` names a `.mtl`, and the `.mtl` names the
 * textures. Only the second level carries the maps, so following just the first
 * gives a model that imports and renders white.
 */
export class ObjImporter extends ModelImporter<ObjModelSettings> {
  readonly id = 'model.obj';
  readonly extensions = ['obj'];
  override get label(): string {
    return 'OBJ';
  }

  defaultSettings(): ObjModelSettings {
    return { ...this.baseDefaults(), format: 'obj', computeNormals: true };
  }

  protected override formatFields(): readonly ImportField[] {
    return [field.group('OBJ', [field.toggle('computeNormals', 'Compute normals if missing')])];
  }

  override async companions(fileName: string, read: TextReader): Promise<readonly string[]> {
    const text = await read(fileName);
    if (text === null) return [];

    const found = new CompanionSet();
    for (const match of text.matchAll(OBJ_LIBRARY)) {
      const library = match[1]?.trim();
      found.add(library);
      if (library === undefined || library === '') continue;

      const mtl = await read(library);
      // Named but not there. The import still proceeds; the load warns.
      if (mtl === null) continue;

      // Relative to the library, not to the model that names it: an `.mtl` one
      // folder down means its `map_Kd wood.png` is in that folder too.
      const libraryDir = relativeDirname(library);
      for (const map of mtl.matchAll(MTL_MAP)) {
        // Options come before the file name: `map_Kd -s 1 1 1 wood.png`.
        const texture = map[1]?.trim().split(/\s+/).at(-1);
        if (texture === undefined) continue;
        found.add(relativeJoin(libraryDir, texture));
      }
    }
    return found.toArray();
  }
}
