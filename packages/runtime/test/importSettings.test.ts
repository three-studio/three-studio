import type {
  FbxModelSettings,
  GltfModelSettings,
  ObjModelSettings,
  TextureSettings,
} from '@three-studio/core';
import {
  AnimationClip,
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  Group,
  LinearSRGBColorSpace,
  Mesh,
  MeshStandardNodeMaterial,
  Object3D,
  PerspectiveCamera,
  PointLight,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
} from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { applyModelSettings, applyTextureSettings } from '../src/assets/importSettings';

/*
 * The other half of the import dialog. Settings the author chose that no loader
 * reads are settings that do not exist — this is what stops the dialog being a
 * form over a file nobody opens.
 */

const modelBase = {
  kind: 'model',
  scale: 1,
  upAxis: 'y',
  generateColliders: false,
  importMaterials: true,
  importAnimations: true,
} as const;

const fbx = (over: Partial<FbxModelSettings> = {}): FbxModelSettings => ({
  ...modelBase,
  format: 'fbx',
  collisionMeshes: 'ignore',
  ...over,
});

const gltf = (over: Partial<GltfModelSettings> = {}): GltfModelSettings => ({
  ...modelBase,
  format: 'gltf',
  importCameras: false,
  importLights: false,
  ...over,
});

const obj = (over: Partial<ObjModelSettings> = {}): ObjModelSettings => ({
  ...modelBase,
  format: 'obj',
  computeNormals: true,
  ...over,
});

function triangle(): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
  );
  return new Mesh(geometry, new MeshStandardNodeMaterial());
}

describe('a model, as it was imported', () => {
  it('scales without overwriting the transform the file already had', () => {
    // An export whose root is not identity is ordinary, and writing the import
    // scale onto it would move the model as well as resize it.
    const loaded = new Object3D();
    loaded.position.set(1, 2, 3);
    loaded.name = 'Tree';

    const root = applyModelSettings(loaded, fbx({ scale: 0.01 }));

    expect(root).not.toBe(loaded);
    expect(root.scale.toArray()).toEqual([0.01, 0.01, 0.01]);
    expect(loaded.position.toArray()).toEqual([1, 2, 3]);
    // The wrapper answers to the same name, so the hierarchy still reads right.
    expect(root.name).toBe('Tree');
  });

  it('stands a Z-up file upright', () => {
    const root = applyModelSettings(new Object3D(), fbx({ upAxis: 'z' }));
    expect(root.rotation.x).toBeCloseTo(-Math.PI / 2);
    expect(applyModelSettings(new Object3D(), fbx({ upAxis: 'y' })).rotation.x).toBe(0);
  });

  it('drops the collision hulls Unreal writes beside the geometry', () => {
    const loaded = new Group();
    const body = triangle();
    body.name = 'Trunk';
    const hull = triangle();
    hull.name = 'UCX_Trunk_01';
    loaded.add(body, hull);

    applyModelSettings(loaded, fbx({ collisionMeshes: 'ignore' }));

    // Removed rather than hidden: an invisible mesh still costs a bounding box
    // and a pick, and it is the box a click lands on.
    expect(loaded.children.map((child) => child.name)).toEqual(['Trunk']);
  });

  it('keeps them when the author asks for them', () => {
    const loaded = new Group();
    const hull = triangle();
    hull.name = 'UCX_Trunk_01';
    loaded.add(hull);

    applyModelSettings(loaded, fbx({ collisionMeshes: 'keep' }));
    expect(loaded.children).toHaveLength(1);
  });

  it("leaves a glTF's cameras and lights out unless they were asked for", () => {
    const withThem = new Group();
    withThem.add(new PerspectiveCamera(), new PointLight(), triangle());
    applyModelSettings(withThem, gltf());
    expect(withThem.children).toHaveLength(1);

    const kept = new Group();
    kept.add(new PerspectiveCamera(), new PointLight(), triangle());
    applyModelSettings(kept, gltf({ importCameras: true, importLights: true }));
    expect(kept.children).toHaveLength(3);
  });

  it('computes the normals an OBJ did not declare, and only those', () => {
    const missing = new Group();
    const bare = triangle();
    missing.add(bare);

    applyModelSettings(missing, obj({ computeNormals: true }));
    expect(bare.geometry.getAttribute('normal')).toBeDefined();

    const declared = new Group();
    const shaded = triangle();
    const normals = new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3);
    shaded.geometry.setAttribute('normal', normals);
    declared.add(shaded);

    applyModelSettings(declared, obj({ computeNormals: true }));
    // Untouched: the file's own normals are the author's, and recomputing them
    // flattens whatever smoothing was exported.
    expect(shaded.geometry.getAttribute('normal')).toBe(normals);
  });

  it('keeps the clips the loader found beside the file, or drops them', () => {
    // glTF keeps its clips beside the scene rather than on it, so a cache that
    // read `gltf.scene` alone lost every animation a glTF had — silently.
    const clip = new AnimationClip('Idle', 1, []);

    const kept = applyModelSettings(new Object3D(), gltf({ importAnimations: true }), [clip]);
    expect(kept.animations).toEqual([clip]);

    const dropped = applyModelSettings(new Object3D(), gltf({ importAnimations: false }), [clip]);
    expect(dropped.animations).toEqual([]);
  });

  it('swaps every material for one when materials are turned off', () => {
    const loaded = new Group();
    const first = triangle();
    const second = triangle();
    loaded.add(first, second);

    applyModelSettings(loaded, fbx({ importMaterials: false }));

    expect(first.material).toBe(second.material);
    expect(first.material).not.toBeInstanceOf(Array);
  });
});

describe('a texture, as it was imported', () => {
  const settings = (over: Partial<TextureSettings> = {}): TextureSettings => ({
    kind: 'texture',
    colorSpace: 'srgb',
    wrap: 'repeat',
    flipY: true,
    encoding: 'sdr',
    generateMipmaps: true,
    anisotropy: 1,
    ...over,
  });

  it('carries the colour space, wrapping and filtering the author chose', () => {
    const texture = new Texture();
    const before = texture.version;
    applyTextureSettings(texture, settings({ colorSpace: 'linear', wrap: 'clamp', anisotropy: 8 }));

    expect(texture.colorSpace).toBe(LinearSRGBColorSpace);
    expect(texture.wrapS).toBe(ClampToEdgeWrapping);
    expect(texture.wrapT).toBe(ClampToEdgeWrapping);
    expect(texture.anisotropy).toBe(8);
    // `needsUpdate` is write-only in three; the version is what it moves, and
    // what actually queues the re-upload these changes need.
    expect(texture.version).toBeGreaterThan(before);
  });

  it('turns mipmaps and flipping off when they were turned off', () => {
    const texture = new Texture();
    applyTextureSettings(texture, settings({ flipY: false, generateMipmaps: false }));

    expect(texture.flipY).toBe(false);
    expect(texture.generateMipmaps).toBe(false);
  });

  it('reads sRGB and repeat as the defaults they are', () => {
    const texture = new Texture();
    applyTextureSettings(texture, settings());
    expect(texture.colorSpace).toBe(SRGBColorSpace);
    expect(texture.wrapS).toBe(RepeatWrapping);
  });
});
