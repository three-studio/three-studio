import { createComponent, createLightEntity, createMaterial, createMeshComponent, type CameraComponent, type LightComponent, type MeshComponent, type ModelComponent } from '@three-studio/core';
import {
  BoxGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicNodeMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  ProjectorLight,
  RectAreaLight,
  Texture,
} from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { ModelCache } from '../../src/assets/ModelCache';
import { CameraSystem } from '../../src/systems/CameraSystem';
import type { SystemContext } from '../../src/systems/ComponentSystem';
import { ENTITY_ID_KEY } from '../../src/systems/identity';
import { LightSystem } from '../../src/systems/LightSystem';
import { MeshSystem } from '../../src/systems/MeshSystem';
import { ModelSystem } from '../../src/systems/ModelSystem';
import { ResourceArena } from '../../src/systems/ResourceArena';

/*
 * One class per component type that draws something, testable on its own —
 * which is the point of the split, and something the 1 564-line binder could
 * not offer: fourteen tests covered it, and not one of them could name a piece.
 *
 * The contract they all pin is `patch` against `'remount'`. Before phase 11 the
 * decision was taken in three separate places that had never been compared:
 * materials patched in place, lights and cameras too, and a mesh with rules of
 * its own. Now each system has to answer out loud, and a test can ask.
 */

function context(materials: Record<string, ReturnType<typeof createMaterial>> = {}): {
  ctx: SystemContext;
  arena: ResourceArena;
  invalidated: () => number;
} {
  const arena = new ResourceArena();
  let invalidated = 0;
  const ctx: SystemContext = {
    arena,
    materials,
    models: new ModelCache({ url: () => null }),
    shadowMapSize: 1024,
    invalidate: () => void (invalidated += 1),
    attach: () => true,
  };
  return { ctx, arena, invalidated: () => invalidated };
}

describe('the mesh system', () => {
  it('keeps the geometry, the material and the mesh across an edit that touches none', () => {
    const { ctx, arena } = context();
    const system = new MeshSystem();
    const component = createMeshComponent('box');

    const first = system.mount('cube', component, ctx);
    const next: MeshComponent = { ...component, castShadow: false };
    const second = system.patch(first, component, next, ctx);

    // Immer preserves the identity of what a mutation did not touch, so the
    // geometry def compares equal by reference and nothing is rebuilt.
    expect(second.mesh).toBe(first.mesh);
    expect(second.geometry).toBe(first.geometry);
    expect(second.material).toBe(first.material);
    expect(second.mesh.castShadow).toBe(false);
    expect(arena.sizes.geometries).toBe(1);
  });

  it('swaps the geometry and gives the old one back when the shape changes', () => {
    const { ctx, arena } = context();
    const system = new MeshSystem();
    const component = createMeshComponent('box');
    const first = system.mount('cube', component, ctx);

    const next: MeshComponent = { ...component, geometry: { ...component.geometry, width: 4 } as MeshComponent['geometry'] };
    const second = system.patch(first, component, next, ctx);

    expect(second.geometry).not.toBe(first.geometry);
    // Exactly one reference per live handle: the old key was released as the
    // new one was taken, so the pool holds one and not two.
    expect(arena.sizes.geometries).toBe(1);
    // And the `Mesh` survives, which keeps the outline and the gizmo pointing
    // at the same object.
    expect(second.mesh).toBe(first.mesh);
  });

  it('patches an embedded material in place while the slots are unchanged', () => {
    const { ctx } = context();
    const system = new MeshSystem();
    const component = createMeshComponent('box');
    const first = system.mount('cube', component, ctx);

    const next: MeshComponent = {
      ...component,
      material: { ...component.material, color: '#ff0000', roughness: 0.1 },
    };
    const second = system.patch(first, component, next, ctx);

    // A node material with a different texture slot is a different shader
    // pipeline; a colour is a uniform. Rebuilding for a uniform is what cost
    // 240ms per inspector drag on a subdivided ground.
    expect(second.material).toBe(first.material);
  });

  it('rebuilds the material when a texture slot is filled', () => {
    const { ctx } = context();
    const system = new MeshSystem();
    const component = createMeshComponent('box');
    const first = system.mount('cube', component, ctx);

    const next: MeshComponent = {
      ...component,
      material: { ...component.material, normalMap: 'tex-1' },
    };
    const second = system.patch(first, component, next, ctx);

    expect(second.material).not.toBe(first.material);
  });

  it('shares one material between every mesh naming the same asset', () => {
    const { ctx, arena } = context({ 'mat-1': createMaterial('#00ff00') });
    const system = new MeshSystem();
    const component: MeshComponent = { ...createMeshComponent('box'), materialId: 'mat-1' };

    const one = system.mount('a', component, ctx);
    const two = system.mount('b', { ...component, id: 'other' }, ctx);

    expect(two.material).toBe(one.material);
    expect(arena.sizes.materials).toBe(1);

    system.unmount(one, ctx);
    expect(arena.sizes.materials).toBe(1);
    system.unmount(two, ctx);
    expect(arena.sizes.materials).toBe(0);
  });

  it('hands its private material over when the mesh is linked to an asset', () => {
    const { ctx, arena } = context({ 'mat-1': createMaterial('#00ff00') });
    const system = new MeshSystem();
    const component = createMeshComponent('box');
    const first = system.mount('cube', component, ctx);

    let disposed = 0;
    first.material.dispose = () => void (disposed += 1);

    const linked: MeshComponent = { ...component, materialId: 'mat-1' };
    system.patch(first, component, linked, ctx);
    arena.flush();

    // Nothing else can free it: an embedded material is owned by its handle
    // alone, so a handle that stops holding one has to say so.
    expect(disposed).toBe(1);
  });

  it('stamps the entity id, or the object is silently unclickable', () => {
    const { ctx } = context();
    const system = new MeshSystem();
    const component = createMeshComponent('box');

    const handle = system.mount('cube-1', component, ctx);
    expect(handle.mesh.userData[ENTITY_ID_KEY]).toBe('cube-1');

    const patched = system.patch(handle, component, { ...component, castShadow: false }, ctx);
    expect(patched.mesh.userData[ENTITY_ID_KEY]).toBe('cube-1');
  });
});

describe('the light system', () => {
  /*
   * Through `createLightEntity` rather than by overriding `kind` on a blank
   * component, so each kind arrives with its own defaults — three's units differ
   * by an order of magnitude between them, and a rect area light built from the
   * point defaults would be testing a light nobody can create.
   */
  const light = (kind: LightComponent['kind']): LightComponent => {
    const component = createLightEntity(kind).components[0];
    if (component?.type !== 'light') throw new Error('no light component');
    return component;
  };

  const LIGHT_KINDS = [
    'ambient',
    'hemisphere',
    'directional',
    'point',
    'spot',
    'rectArea',
    'projector',
  ] as const satisfies readonly LightComponent['kind'][];

  it.each(LIGHT_KINDS.filter((kind) => kind !== 'hemisphere'))(
    'builds a %s light on its entity origin, not where three puts it',
    (kind) => {
      /*
       * `DirectionalLight`, `SpotLight` and `HemisphereLight` construct at
       * `(0, 1, 0)` so that a light added straight to a scene shines downward.
       * Here the entity's transform places it, and that default left the light
       * a metre above the entity holding it — the gizmo, the marker and the
       * outline on the entity, and the light itself somewhere else. It also
       * moved the shadow camera, which is centred on the light's position.
       */
      const { ctx } = context();
      const handle = new LightSystem().mount('sun', light(kind), ctx);

      expect(handle.light.position.toArray()).toEqual([0, 0, 0]);
    },
  );

  it('leaves a hemisphere light its up vector, because that is its direction', () => {
    /*
     * The exception to the rule above, and the one place where moving a light
     * to its entity's origin is destructive rather than tidy.
     *
     * `HemisphereLightNode` builds the sky-to-ground axis as
     * `normalize(worldPosition)`. At the origin that normalises a zero vector,
     * which is undefined in WGSL: the irradiance comes back NaN, and NaN added
     * to a fragment's running irradiance blacks out the fragment — every
     * surface and every other light with it. The starter scene ships a
     * hemisphere light, so the whole viewport went black and deleting that one
     * light "fixed the lighting".
     */
    const { ctx } = context();
    const handle = new LightSystem().mount('sky', light('hemisphere'), ctx);

    expect(handle.light.position.toArray()).toEqual([0, 1, 0]);
    expect(handle.light.position.length()).toBeGreaterThan(0);
  });

  it('writes scalars onto the light it already built', () => {
    const { ctx } = context();
    const system = new LightSystem();
    const component = light('directional');
    const handle = system.mount('sun', component, ctx);

    const patched = system.patch(handle, component, { ...component, intensity: 9 }, ctx);

    // B9: a directional light owns a shadow map of `shadowMapSize` squared and
    // only `dispose()` frees it. Rebuilding on every edit allocated one per
    // frame of a slider drag and abandoned the last.
    expect(patched).not.toBe('remount');
    expect(patched === 'remount' ? null : patched.light).toBe(handle.light);
    expect((handle.light as DirectionalLight).intensity).toBe(9);
  });

  it('asks to be remounted when the kind changes, because that is another class', () => {
    const { ctx } = context();
    const system = new LightSystem();
    const component = light('directional');
    const handle = system.mount('sun', component, ctx);

    expect(system.patch(handle, component, light('hemisphere'), ctx)).toBe('remount');
    expect(handle.light).toBeInstanceOf(DirectionalLight);

    const remounted = system.mount('sun', light('hemisphere'), ctx);
    expect(remounted.light).toBeInstanceOf(HemisphereLight);
  });

  it('retires the light rather than disposing it where it stands', () => {
    const { ctx, arena } = context();
    const system = new LightSystem();
    const handle = system.mount('sun', light('point'), ctx);

    let disposed = 0;
    (handle.light as unknown as { dispose: () => void }).dispose = () => void (disposed += 1);

    system.unmount(handle, ctx);
    expect(disposed).toBe(0);
    arena.flush();
    expect(disposed).toBe(1);
  });

  it('sizes the shadow map of every kind that casts one, not just the sun', () => {
    /*
     * `mapSize` used to be written on the directional branch alone. A point and
     * a spot light are both born casting, so they ran at three's default 512
     * while the directional beside them ran at the project's setting — no error,
     * no log, just shadows that were softer on some lights than on others for a
     * reason nothing in the document named.
     */
    const system = new LightSystem();
    for (const kind of ['directional', 'point', 'spot', 'projector'] as const) {
      const { ctx } = context();
      const handle = system.mount('caster', light(kind), ctx);
      const shadow = (handle.light as DirectionalLight).shadow;

      expect(shadow.mapSize.toArray(), kind).toEqual([1024, 1024]);
      expect(shadow.camera.near, kind).toBe(0.5);
      expect(shadow.camera.far, kind).toBe(500);
    }
  });

  it('has no shadow to configure on an area light, and does not invent one', () => {
    // three shades a rect area light with linearly transformed cosines and gives
    // it no shadow path at all. `applyShadow` tests for the object rather than
    // listing kinds, so this is what stops it writing onto `undefined`.
    const { ctx } = context();
    const handle = new LightSystem().mount('window', light('rectArea'), ctx);

    expect(handle.light).toBeInstanceOf(RectAreaLight);
    expect((handle.light as RectAreaLight & { shadow?: unknown }).shadow).toBeUndefined();
  });

  it('carries the rectangle onto an area light, and edits it in place', () => {
    const { ctx } = context();
    const system = new LightSystem();
    const component = { ...light('rectArea'), width: 4, height: 2 };
    const handle = system.mount('window', component, ctx);
    expect((handle.light as RectAreaLight).width).toBe(4);

    const patched = system.patch(handle, component, { ...component, height: 7 }, ctx);

    expect(patched).not.toBe('remount');
    expect((handle.light as RectAreaLight).height).toBe(7);
  });

  it('writes a shadow setting without throwing the shadow map away', () => {
    /*
     * The whole point of `patch` over a rebuild, applied to the fields that were
     * previously set at construction and never again: before this, dragging the
     * bias slider changed the document and nothing else until the light happened
     * to be remounted for some other reason.
     */
    const { ctx } = context();
    const system = new LightSystem();
    const component = light('directional');
    const handle = system.mount('sun', component, ctx);

    const next = { ...component, shadow: { ...component.shadow, bias: -0.0004, orthoSize: 40 } };
    const patched = system.patch(handle, component, next, ctx);

    expect(patched).not.toBe('remount');
    const shadow = (handle.light as DirectionalLight).shadow;
    expect(shadow.bias).toBe(-0.0004);
    expect(shadow.camera.right).toBe(40);
    // Read off the projection matrix rather than the camera, because that is
    // what three renders the shadow through — and it is not rebuilt on its own.
    expect(shadow.camera.projectionMatrix.elements[0]).toBeCloseTo(1 / 40);
  });

  it('swaps a projector cookie in place, and retires the one it replaces', () => {
    const { ctx, arena } = context();
    // `ModelCache.instanceTexture` goes through `TextureLoader`, which needs a
    // DOM to decode an image. What is under test is the ownership, not the
    // decode, so the cache hands back bare textures here.
    (ctx as { models: unknown }).models = { instanceTexture: () => new Texture() };

    const system = new LightSystem();
    const component = { ...light('projector'), mapId: 'gobo-a' };
    const handle = system.mount('projector', component, ctx);

    const first = (handle.light as ProjectorLight).map;
    expect(first).not.toBeNull();
    expect(handle.texture).toBe(first);

    let disposed = 0;
    if (first) first.dispose = () => void (disposed += 1);

    const patched = system.patch(handle, component, { ...component, mapId: 'gobo-b' }, ctx);

    // Not a remount: a light's shadow map costs far more than a texture, and
    // changing which picture it throws should not cost one. See B9.
    expect(patched).not.toBe('remount');
    expect((handle.light as ProjectorLight).map).not.toBe(first);
    // Retired, not disposed where it stands — a frame already encoding may still
    // be sampling it.
    expect(disposed).toBe(0);
    arena.flush();
    expect(disposed).toBe(1);
  });

  it('gives a projector no cookie when its slot is empty', () => {
    const { ctx } = context();
    const handle = new LightSystem().mount('projector', light('projector'), ctx);

    expect((handle.light as ProjectorLight).map).toBeNull();
    expect(handle.texture).toBeNull();
    // `null` rather than `0`: three reads the aspect off the texture when it is
    // not set, and `0` would be an aspect of zero.
    expect((handle.light as ProjectorLight).aspect).toBeNull();
  });
});

describe('the camera system', () => {
  const camera = (projection: CameraComponent['projection']): CameraComponent => ({
    ...(createComponent('camera') as CameraComponent),
    projection,
  });

  it('writes the frustum onto the camera it already built', () => {
    const { ctx } = context();
    const system = new CameraSystem();
    const component = camera('perspective');
    const handle = system.mount('cam', component, ctx);

    const patched = system.patch(handle, component, { ...component, fov: 30 }, ctx);
    expect(patched).not.toBe('remount');
    expect((handle.camera as PerspectiveCamera).fov).toBe(30);
  });

  it('asks to be remounted when the projection changes', () => {
    const { ctx } = context();
    const system = new CameraSystem();
    const component = camera('perspective');
    const handle = system.mount('cam', component, ctx);

    expect(system.patch(handle, component, camera('orthographic'), ctx)).toBe('remount');
    expect(system.mount('cam', camera('orthographic'), ctx).camera).toBeInstanceOf(
      OrthographicCamera,
    );
  });

  it('frees nothing, because a camera has no dispose', () => {
    const { ctx, arena } = context();
    const system = new CameraSystem();
    const handle = system.mount('cam', camera('perspective'), ctx);

    // Adding a camera to the disposables alongside the lights threw
    // `disposable.dispose is not a function` on the first Stop.
    expect(() => system.unmount(handle, ctx)).not.toThrow();
    expect(() => arena.flush()).not.toThrow();
  });
});

/*
 * A stand-in for the model cache, so a system that loads files can be tested
 * without one.
 *
 * It records what was asked for, which is half of what these tests check: a
 * component naming a node must reach `loadNode` and not `loadModel`, because
 * `loadModel` clones the whole tree and an unpacked file would clone itself
 * once per part.
 */
function stubCache(): { models: ModelCache; asked: string[] } {
  const asked: string[] = [];
  const node = () => {
    const mesh = new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial());
    mesh.name = 'Seat';
    return mesh;
  };
  const models = {
    loadModel: (assetId: string) => {
      asked.push(`whole:${assetId}`);
      const group = new Group();
      group.add(node());
      return Promise.resolve(group);
    },
    loadNode: (assetId: string, path: string) => {
      asked.push(`node:${assetId}:${path}`);
      return Promise.resolve(node());
    },
  };
  return { models: models as unknown as ModelCache, asked };
}

const modelComponent = (partial: Partial<ModelComponent> = {}): ModelComponent => ({
  ...createComponent('model'),
  assetId: 'chair',
  ...partial,
});

describe('the model system', () => {
  it('asks for one node when the component names one', async () => {
    const { ctx } = context();
    const { models, asked } = stubCache();
    const system = new ModelSystem();

    system.mount('chair', modelComponent({ nodePath: '0.0.1', nodeName: 'Seat' }), {
      ...ctx,
      models,
    });
    await system.whenLoaded();

    // Not `loadModel`: that clones the whole tree, so a two-hundred-node model
    // unpacked would deep-clone the entire file two hundred times.
    expect(asked).toEqual(['node:chair:0.0.1']);
  });

  it('asks for the whole file when it names no node', async () => {
    const { ctx } = context();
    const { models, asked } = stubCache();
    const system = new ModelSystem();

    system.mount('chair', modelComponent(), { ...ctx, models });
    await system.whenLoaded();

    expect(asked).toEqual(['whole:chair']);
  });

  it('remounts for a different node, and not for a shadow flag', () => {
    const { ctx } = context();
    const { models } = stubCache();
    const system = new ModelSystem();
    const ctxWith = { ...ctx, models };
    const component = modelComponent({ nodePath: '0.0.1', nodeName: 'Seat' });

    const handle = system.mount('chair', component, ctxWith);

    // A different node is a different object; a checkbox is not worth a network
    // fetch and a parse.
    expect(system.patch(handle, component, { ...component, nodePath: '0.0.2' }, ctxWith)).toBe(
      'remount',
    );
    expect(system.patch(handle, component, { ...component, castShadow: false }, ctxWith)).toBe(
      handle,
    );
  });

  it('takes exactly one pooled reference for a material, and gives it back', async () => {
    const material = createMaterial();
    const { ctx, arena } = context({ shared: material });
    const { models } = stubCache();
    const system = new ModelSystem();
    const ctxWith = { ...ctx, models };
    // A single node, so the object the handle holds is the mesh itself.
    const plain = modelComponent({ nodePath: '0.0.1', nodeName: 'Seat' });
    const linked = { ...plain, materialId: 'shared' };

    const handle = system.mount('chair', linked, ctxWith);
    await system.whenLoaded();
    expect(arena.sizes.materials).toBe(1);

    // The file's own material is remembered before it is overwritten, so
    // clearing the field puts it back rather than leaving the last override on.
    const drawn = handle.objects[0] as Mesh;
    const override = drawn.material;
    expect(handle.materialKey).toBe('shared');

    const back = system.patch(handle, linked, plain, ctxWith);
    expect(back).not.toBe('remount');
    expect(arena.sizes.materials).toBe(0);
    expect(drawn.material).not.toBe(override);
  });

  it('gives its material back on unmount, whatever else it frees', async () => {
    const { ctx, arena } = context({ shared: createMaterial() });
    const { models } = stubCache();
    const system = new ModelSystem();
    const ctxWith = { ...ctx, models };

    const handle = system.mount('chair', modelComponent({ materialId: 'shared' }), ctxWith);
    await system.whenLoaded();
    system.unmount(handle, ctxWith);

    // Everything else it holds belongs to `ModelCache` — the geometries and
    // materials of the file, which every other clone is still drawing. The
    // pooled material is the one thing it ever took.
    expect(arena.sizes.materials).toBe(0);
  });
});
