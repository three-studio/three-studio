import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { ASSET_KIND_INFO } from '@three-studio/core';
import {
  FileLoader,
  Group,
  LoaderUtils,
  LoadingManager,
  TextureLoader,
  type AnimationClip,
  type Object3D,
} from 'three/webgpu';

/**
 * What `loadModelFromUrl` knows how to open. Read from the URL.
 *
 * The importers' list rather than one of its own: a model importer exists
 * because a loader below can open the format, so writing the four out again
 * here was a second list that could only ever be wrong. The `default` case
 * below is what happens if one ever is.
 */
export const MODEL_EXTENSIONS: ReadonlySet<string> = new Set(ASSET_KIND_INFO.model.extensions);

/** The extension of a URL, lowercased, with any query or fragment dropped. */
export function extensionOf(url: string): string {
  const path = url.split(/[?#]/)[0] ?? url;
  return path.slice(path.lastIndexOf('.') + 1).toLowerCase();
}

/**
 * The subset of the glTF document this file reads. Written out rather than
 * imported: `GLTFLoader` ships no types for its parser, and what is needed here
 * is two fields.
 */
interface GltfDocument {
  textures?: { source?: number }[];
  images?: { bufferView?: number; uri?: string }[];
}

/**
 * Which image a texture draws, when that image is **embedded** in the file.
 *
 * `null` for everything else — a texture that names no source, or one whose
 * image has a `uri` and is therefore fetched from its own URL. Separated from
 * the plugin below because it is the whole of the decision, and a decision
 * inside a loader callback is one nothing can run.
 */
export function embeddedImageSource(json: GltfDocument, textureIndex: number): number | null {
  const sourceIndex = json.textures?.[textureIndex]?.source;
  if (sourceIndex === undefined) return null;

  const image = json.images?.[sourceIndex];
  return image !== undefined && image.bufferView !== undefined ? sourceIndex : null;
}

/**
 * Decodes a glTF's embedded images through an `<img>` instead of through `fetch`.
 *
 * `ImageBitmapLoader` — which `GLTFLoader` picks whenever `createImageBitmap`
 * exists, so always here — loads an image by wrapping its bytes in a Blob,
 * making an object URL for it, and calling `fetch()` on that URL. **Chromium
 * refuses that fetch for a large blob**: `TypeError: Failed to fetch`, with
 * nothing else to go on. three catches it, prints `Couldn't load texture
 * <blob url>` and resolves to `null`, so the model arrives fully built, fully
 * lit, and completely grey — which reads as a broken exporter rather than as a
 * failed download.
 *
 * Measured in this app, on a 166 MB museum scan whose two JPEGs are 42 MB and
 * 38 MB. The ceiling is on the **blob**, not on the image: a 24 MiB blob
 * fetches and a 28 MiB one does not, while that same 8192x8192 JPEG decodes at
 * full size through `createImageBitmap`, and loads at full size through an
 * `<img>`, in the same renderer moments apart.
 *
 * So the embedded ones come in through `TextureLoader`, which is an `<img>` and
 * has no such ceiling. What that costs is the decode moving onto the main
 * thread, which is a hitch while a model loads — set against a texture that
 * otherwise never arrives at all.
 *
 * Only `bufferView` images, because they are the only ones that become blobs;
 * an image with a `uri` is fetched from `studio-asset://` by URL and never comes
 * near this. And registered *after* three's own texture extensions, which are
 * registered in its constructor and therefore run first: a texture declaring
 * KTX2, WebP or AVIF is claimed by them, and this only ever sees what is left.
 */
function withoutBlobFetch(loader: GLTFLoader, manager: LoadingManager): GLTFLoader {
  const textureLoader = new TextureLoader(manager);

  loader.register((parser) => ({
    name: 'STUDIO_embedded_images_without_fetch',
    loadTexture(textureIndex: number) {
      const sourceIndex = embeddedImageSource(parser.json as GltfDocument, textureIndex);
      if (sourceIndex === null) return null;

      // three's own path from here: the samplers, the colour space and the
      // `associations` map are its work, and only the decode changes.
      return parser.loadTextureImage(textureIndex, sourceIndex, textureLoader);
    },
  }));

  return loader;
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
      const gltf = await withoutBlobFetch(
        new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder),
        manager,
      ).loadAsync(url);
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
