import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import {
  FileLoader,
  Group,
  LoaderUtils,
  LoadingManager,
  type AnimationClip,
  type Object3D,
} from 'three/webgpu';

/** What `loadModelFromUrl` knows how to open. Read from the URL. */
export const MODEL_EXTENSIONS = new Set(['glb', 'gltf', 'fbx', 'obj']);

/** The extension of a URL, lowercased, with any query or fragment dropped. */
export function extensionOf(url: string): string {
  const path = url.split(/[?#]/)[0] ?? url;
  return path.slice(path.lastIndexOf('.') + 1).toLowerCase();
}

export interface LoadedModel {
  object: Object3D;
  /**
   * The clips the file declares.
   *
   * Handed back separately rather than left on the object because glTF keeps
   * them beside the scene rather than on it — reading `gltf.scene` alone, which
   * is what the cache did for a long time, silently drops every animation a
   * glTF has.
   */
  animations: readonly AnimationClip[];
}

/**
 * Opens a model file, picking the loader from its extension.
 *
 * The one place that has to know one format from another — everything
 * downstream sees an `Object3D`. It takes a URL rather than an asset id so the
 * import dialog can open a file that is not in the project yet, and the cache
 * can open one that is, through the same table.
 *
 * glTF and FBX are self-describing. OBJ is not: it names its material library
 * in a `mtllib` line that `OBJLoader` does not follow on its own, so the file
 * is read first, the `.mtl` loaded, and only then parsed. Without that an OBJ
 * arrives in three's default white, which reads as a broken import rather than
 * as "you did not load the materials".
 *
 * DRACO and KTX2 are not wired up: their decoders are binaries that have to be
 * served next to the app *and* next to an exported build, which is a build
 * pipeline question rather than a loading one. Meshopt is, because it is a
 * plain module that bundles — and it is what glTF-Transform emits by default,
 * so it covers a good share of what people actually have.
 */
export async function loadModelFromUrl(
  url: string,
  manager: LoadingManager,
): Promise<LoadedModel> {
  const path = url.split(/[?#]/)[0] ?? url;

  switch (extensionOf(url)) {
    case 'glb':
    case 'gltf': {
      const gltf = await new GLTFLoader(manager)
        .setMeshoptDecoder(MeshoptDecoder)
        .loadAsync(url);
      return { object: gltf.scene, animations: gltf.animations };
    }

    case 'fbx': {
      // Returns a `Group` already, with its clips on `animations`; three maps
      // its Phong materials onto node materials at render time, so nothing more
      // is needed here.
      const group = await new FBXLoader(manager).loadAsync(url);
      return { object: group, animations: group.animations };
    }

    case 'obj': {
      const text = (await new FileLoader(manager).loadAsync(url)) as string;
      const loader = new OBJLoader(manager);

      const library = /^\s*mtllib\s+(.+)$/m.exec(text)?.[1]?.trim();
      if (library !== undefined && library !== '') {
        try {
          // `extractUrlBase` is three's own, and it handles the cases a
          // `lastIndexOf('/')` does not — query strings, and a bare name.
          const libraryUrl = LoaderUtils.extractUrlBase(url) + library;
          // A `.mtl` names its textures relative to *itself*, not to the model
          // that names it. Both paths point at its own folder, or an `.mtl` one
          // level down loses every map it declares.
          const libraryBase = LoaderUtils.extractUrlBase(libraryUrl);
          const materials = await new MTLLoader(manager)
            .setPath(libraryBase)
            .setResourcePath(libraryBase)
            .loadAsync(libraryUrl.slice(libraryBase.length));
          materials.preload();
          loader.setMaterials(materials);
        } catch (cause) {
          // A missing `.mtl` is worth saying, but not worth losing the geometry
          // over — the model still loads, untextured.
          console.warn(`[assets] could not load ${library} for ${path}`, cause);
        }
      }

      return { object: loader.parse(text), animations: [] };
    }

    default:
      // Not reachable through the asset browser, which only offers what the
      // importers claim, but a scene can name an id from a newer build.
      console.warn(`[assets] no loader for ${path}; placing an empty object.`);
      return { object: new Group(), animations: [] };
  }
}
