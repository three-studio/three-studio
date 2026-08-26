import type { ModelSettings, TextureSettings } from '@three-studio/core';
import {
  ClampToEdgeWrapping,
  Group,
  type AnimationClip,
  LinearSRGBColorSpace,
  MeshStandardNodeMaterial,
  MirroredRepeatWrapping,
  RepeatWrapping,
  SRGBColorSpace,
  type Camera,
  type Light,
  type Mesh,
  type Object3D,
  type Texture,
  type Wrapping,
} from 'three/webgpu';

const WRAPPING: Record<TextureSettings['wrap'], Wrapping> = {
  clamp: ClampToEdgeWrapping,
  repeat: RepeatWrapping,
  mirror: MirroredRepeatWrapping,
};

/** Unreal writes its collision hulls into an FBX under this prefix. */
const COLLISION_PREFIX = 'UCX_';

/**
 * Applies what the author chose in the import dialog to a freshly loaded model.
 *
 * Run once, on the master, before it is cached and cloned: the settings belong
 * to the file, not to each entity that places it, and doing it per clone would
 * be the same work as many times as the model appears in a level.
 *
 * The transform goes on a wrapper rather than on the loaded root. Writing it
 * onto the root would overwrite whatever transform the file itself put there,
 * which for a great many exports is not identity — and the failure is a model
 * that is subtly in the wrong place, which reads as a bad export.
 */
export function applyModelSettings(
  loaded: Object3D,
  settings: ModelSettings,
  animations: readonly AnimationClip[] = [],
): Object3D {
  prune(loaded, settings);

  if (settings.format === 'obj' && settings.computeNormals) {
    // OBJ may declare no normals at all, and three shades those flat black —
    // which reads as a broken material rather than as missing data.
    loaded.traverse((child) => {
      const geometry = (child as Partial<Mesh>).geometry;
      if (geometry && !geometry.getAttribute('normal')) geometry.computeVertexNormals();
    });
  }

  if (!settings.importMaterials) replaceMaterials(loaded);

  const root = new Group();
  root.name = loaded.name;
  root.add(loaded);
  // Onto the wrapper, from the loader's own list. FBX leaves its clips on the
  // group it returns and glTF keeps them beside the scene rather than on it —
  // so reading `gltf.scene` alone, which the cache did for a long time, dropped
  // every animation a glTF had. `Object3D.copy` slices this, so clones keep it.
  root.animations = settings.importAnimations ? [...animations] : [];
  loaded.animations = [];
  root.scale.setScalar(settings.scale);
  // A quarter turn back about X, which is what "the file calls Z up" amounts to
  // once it is sitting in a Y-up scene.
  if (settings.upAxis === 'z') root.rotation.x = -Math.PI / 2;
  return root;
}

/** Nodes the author asked not to bring in. Removed rather than hidden: an
 * invisible mesh still costs a draw-call decision, a bounding box and a pick. */
function prune(loaded: Object3D, settings: ModelSettings): void {
  const doomed: Object3D[] = [];

  loaded.traverse((child) => {
    if (settings.format === 'fbx' && settings.collisionMeshes === 'ignore') {
      if (child.name.toUpperCase().startsWith(COLLISION_PREFIX)) {
        doomed.push(child);
        return;
      }
    }
    if (settings.format === 'gltf') {
      if (!settings.importCameras && (child as Partial<Camera>).isCamera) doomed.push(child);
      if (!settings.importLights && (child as Partial<Light>).isLight) doomed.push(child);
    }
  });

  for (const child of doomed) {
    child.removeFromParent();
    disposeTree(child);
  }
}

function replaceMaterials(loaded: Object3D): void {
  // One shared material, not one per mesh: the point of turning materials off
  // is to see the shape, and forty copies of the same grey is forty pipelines.
  const plain = new MeshStandardNodeMaterial();
  loaded.traverse((child) => {
    const mesh = child as Partial<Mesh>;
    if (!mesh.geometry) return;
    for (const material of materialsOf(mesh.material)) material.dispose();
    (child as Mesh).material = plain;
  });
}

/**
 * Applies a texture asset's own import settings to an instance of it.
 *
 * The baseline every use starts from. A use that knows better still overrides:
 * a material sets the colour space per slot, because whether a map is colour or
 * data is a property of what it is plugged into rather than of the file — the
 * same image can legitimately be a base colour on one mesh and a mask on
 * another. Filtering, mipmaps and `flipY` have no such per-use answer, so this
 * is the only place they are decided.
 */
export function applyTextureSettings(texture: Texture, settings: TextureSettings): void {
  texture.colorSpace = settings.colorSpace === 'srgb' ? SRGBColorSpace : LinearSRGBColorSpace;
  texture.wrapS = WRAPPING[settings.wrap];
  texture.wrapT = WRAPPING[settings.wrap];
  texture.flipY = settings.flipY;
  texture.generateMipmaps = settings.generateMipmaps;
  texture.anisotropy = settings.anisotropy;
  texture.needsUpdate = true;
}

function disposeTree(root: Object3D): void {
  root.traverse((child) => {
    const mesh = child as Partial<Mesh>;
    mesh.geometry?.dispose();
    for (const material of materialsOf(mesh.material)) material.dispose();
  });
}

function materialsOf(material: unknown): { dispose(): void }[] {
  if (Array.isArray(material)) return material as { dispose(): void }[];
  if (material && typeof (material as { dispose?: unknown }).dispose === 'function') {
    return [material as { dispose(): void }];
  }
  return [];
}
