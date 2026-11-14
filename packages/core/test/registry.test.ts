import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYER_ID,
  SCENE_FORMAT_VERSION,
  Registry,
  combineDisposables,
  componentAssets,
  conformColliderShape,
  conformPhysicsMaterial,
  createColliderShape,
  createComponent,
  createComponentForEntity,
  createCoreRegistries,
  createEntity,
  createLight,
  createMeshComponent,
  createMeshEntity,
  createPhysicsMaterial,
  createRigidBody,
  deserializeScene,
  fillComponent,
  fixedId,
  serializeScene,
  typesWithoutRuntime,
  type ComponentDoc,
  type ComponentType,
  type LightComponent,
  type MeshComponent,
  type SceneDoc,
} from '../src/index';
import { componentsOf, setComponentsOf } from '../src/scene/components';
import { builtInRegistries } from './registries';

const registries = builtInRegistries();

/*
 * The one registry every table of definitions is: component types, systems,
 * behaviours, importers. Here as a class, on entries of its own; what each
 * layer registers is its own test's.
 */
describe('Registry', () => {
  interface Widget {
    readonly id: string;
    readonly label: string;
  }
  const widget = (id: string, label = id): Widget => ({ id, label });

  it('refuses a second entry under an id, naming the kind and the id, and keeps the first', () => {
    const registry = new Registry<string, Widget>('widget');
    const first = widget('a', 'first');
    registry.register(first);

    expect(() => registry.register(widget('a', 'second'))).toThrow('The widget "a" is already registered.');
    expect(registry.get('a')).toBe(first);
  });

  it('answers the entry under an id, and nothing for an id it does not hold', () => {
    const registry = new Registry<string, Widget>('widget');
    const a = widget('a');
    registry.register(a);

    expect(registry.get('a')).toBe(a);
    expect(registry.get('b')).toBeUndefined();
  });

  it('lists in registration order, the same array until something changes', () => {
    const registry = new Registry<string, Widget>('widget');
    const b = widget('b');
    const a = widget('a');
    registry.register(b);
    const registration = registry.register(a);

    const listed = registry.values();
    expect(listed).toEqual([b, a]);
    expect(registry.values()).toBe(listed);

    registry.register(widget('c'));
    const relisted = registry.values();
    expect(relisted).not.toBe(listed);
    expect(relisted.map(({ id }) => id)).toEqual(['b', 'a', 'c']);

    registration.dispose();
    expect(registry.values()).not.toBe(relisted);
    expect(registry.values().map(({ id }) => id)).toEqual(['b', 'c']);
  });

  it('removes an entry when its registration is disposed, and a second disposal does nothing', () => {
    const registry = new Registry<string, Widget>('widget');
    registry.register(widget('b'));
    const registration = registry.register(widget('a'));

    registration.dispose();
    expect(registry.get('a')).toBeUndefined();
    const listed = registry.values();
    registration.dispose();
    expect(registry.values()).toBe(listed);
    expect(listed.map(({ id }) => id)).toEqual(['b']);
  });

  it('registers an id again once its registration is disposed', () => {
    const registry = new Registry<string, Widget>('widget');
    registry.register(widget('a', 'first')).dispose();
    const second = widget('a', 'second');

    expect(() => registry.register(second)).not.toThrow();
    expect(registry.get('a')).toBe(second);
  });

  it('leaves a later registration of the id in place when a stale registration is disposed', () => {
    const registry = new Registry<string, Widget>('widget');
    const first = widget('a');
    const stale = registry.register(first);
    stale.dispose();
    // The same object again: what is removed is a registration, not whatever
    // happens to sit under its entry's id.
    registry.register(first);

    stale.dispose();
    expect(registry.get('a')).toBe(first);
  });
});

describe('combineDisposables', () => {
  it('disposes the last first, as a stack unwinds, and only once', () => {
    const disposed: string[] = [];
    const combined = combineDisposables(
      ['a', 'b', 'c'].map((name) => ({ dispose: () => disposed.push(name) })),
    );

    combined.dispose();
    combined.dispose();
    expect(disposed).toEqual(['c', 'b', 'a']);
  });

  it('disposes the list it was given, not what was added to that array later', () => {
    const disposed: string[] = [];
    const list = [{ dispose: () => disposed.push('a') }];
    const combined = combineDisposables(list);
    list.push({ dispose: () => disposed.push('b') });

    combined.dispose();
    expect(disposed).toEqual(['a']);
  });
});

describe('component registry', () => {
  it('creates a component of the type asked for', () => {
    for (const { id: type } of registries.components.values()) {
      const component = createComponent(registries, type);
      expect(component.type).toBe(type);
      expect(component.id).toMatch(/\S/);
    }
  });

  /*
   * The chain this replaced ended in `createPlayerController()`, so a component
   * from a plugin or a hand-edited file came back as a player controller with the
   * original's fields glued on — and the migration then wrote that to disk.
   */
  it('refuses a type it has never heard of', () => {
    expect(() => createComponent(registries, 'teleporter' as ComponentType)).toThrow(/Unknown component type/);
    expect(registries.components.get('teleporter' as ComponentType)).toBeUndefined();
  });

  /*
   * Nothing registers by being imported: a type is known to the registries a
   * root activated, and to no others. A built-in type is no exception, and
   * registries nobody activated answer for it what they answer for a plugin's.
   */
  it('treats a type the registries do not hold as unknown, though the kernel defines it', () => {
    const empty = createCoreRegistries();
    const light = createLight('point');

    expect(() => createComponent(empty, 'light')).toThrow(/Unknown component type/);
    expect(fillComponent(empty, light)).toBe(light);
  });

  it('gives two components of a type distinct ids', () => {
    expect(createComponent(registries, 'light').id).not.toBe(createComponent(registries, 'light').id);
  });
});

describe('fill', () => {
  it('fills a component written before a field existed', () => {
    const stored = { id: 'c1', type: 'light' } as unknown as ComponentDoc;
    const filled = fillComponent(registries, stored);
    expect(filled.id).toBe('c1');
    expect(filled).toMatchObject({ type: 'light', intensity: expect.any(Number) });
  });

  it('fills a light against its own kind, not against a fixed one', () => {
    /*
     * three's units differ by an order of magnitude between light kinds: a
     * directional light's default intensity is 2 and a point light's is 12.
     * Filling every light from the point defaults handed a stored directional
     * light six times the brightness its author chose — rule 2 of the
     * persisted-format rules read to the letter and missed in spirit, because
     * the factory that is the source of the defaults takes a kind.
     */
    const stored = { id: 'c1', type: 'light', kind: 'directional' } as unknown as ComponentDoc;
    const filled = fillComponent(registries, stored) as LightComponent;

    expect(filled.kind).toBe('directional');
    expect(filled.intensity).toBe(2);
  });

  it('fills a light a level deeper, so its shadow settings are not undefined', () => {
    const stored = {
      id: 'c1',
      type: 'light',
      kind: 'spot',
      shadow: { bias: -0.0005 },
    } as unknown as ComponentDoc;

    const filled = fillComponent(registries, stored) as LightComponent;
    expect(filled.shadow).toMatchObject({ bias: -0.0005, normalBias: 0, far: 500 });
  });

  /*
   * The one type whose fill is not a shallow spread. Texture slots and geometry
   * segments both reached three as `undefined` on scenes a fortnight old, twice,
   * before this merge went a level deeper — and a slider bound to `undefined`
   * took the whole Inspector down with it.
   */
  it('fills a mesh a level deeper than the top', () => {
    const stored = {
      id: 'c1',
      type: 'mesh',
      geometry: { kind: 'box', width: 4 },
      material: { color: '#ff0000' },
    } as unknown as ComponentDoc;

    const mesh = fillComponent(registries, stored) as MeshComponent;
    expect(mesh.geometry).toMatchObject({ kind: 'box', width: 4, widthSegments: expect.any(Number) });
    expect(mesh.material).toMatchObject({ color: '#ff0000', roughness: expect.any(Number) });
    expect(mesh.materialId).toBeNull();
  });

  /*
   * Physics data is the one place a stored field is not kept for its author:
   * a collider is read against its factory, and its shape against the factory
   * of the kind it names.
   */
  it('reads a collider written before scene 11 as a 1 m box with the default material, keeping its id and sensor', () => {
    const stored = {
      id: 'c1',
      type: 'collider',
      shape: 'capsule',
      size: [0.5, 0.5, 0.5],
      radius: 0.3,
      halfHeight: 0.55,
      friction: 0.2,
      restitution: 0.5,
      isSensor: true,
    } as unknown as ComponentDoc;

    // Its old fields dropped: kept, `friction` would sit beside `material` and
    // read as the collider's to anyone opening the file.
    expect(fillComponent(registries, stored)).toEqual({
      id: 'c1',
      type: 'collider',
      shape: createColliderShape('box'),
      material: createPhysicsMaterial(),
      materialId: null,
      isSensor: true,
      layer: DEFAULT_LAYER_ID,
    });
  });

  it('reads a stored rigid body against its factory, field by field', () => {
    const stored = {
      id: 'c1',
      type: 'rigidbody',
      bodyType: 'kinematicVelocity',
      mass: -3,
      ccd: true,
      lockPosition: [true, 'no', false],
      stray: 1,
    } as unknown as ComponentDoc;

    expect(fillComponent(registries, stored)).toEqual({ ...createRigidBody(), id: 'c1', ccd: true });
  });

  it('fills a shape from its own kind, keeping each measure that fits', () => {
    const stored = { kind: 'capsule', radius: 0.4, height: 'tall', size: [1, 1, 1] };
    expect(conformColliderShape(stored)).toEqual({ ...createColliderShape('capsule'), radius: 0.4 });
  });

  it('reads a material naming a rule this build does not know as Average', () => {
    for (const rule of ['sum', 'constructor']) {
      const stored = { friction: 0.3, frictionCombine: rule, restitutionCombine: rule };
      expect(conformPhysicsMaterial(stored)).toEqual({ ...createPhysicsMaterial(), friction: 0.3 });
    }
  });

  it('builds a mesh whose build this build does not know from its triangles', () => {
    expect(conformColliderShape({ kind: 'mesh', build: 'voxels' })).toEqual({
      kind: 'mesh',
      build: 'triangles',
    });
  });

  it('reads a shape of a kind this build does not know as the factory box, its measures dropped', () => {
    for (const kind of ['teapot', 'constructor', 7]) {
      expect(conformColliderShape({ kind, size: [3, 3, 3] })).toEqual(createColliderShape('box'));
    }
  });

  /*
   * Filling an unknown type against a type we do not have would invent a shape,
   * and the next save would write that invention over the author's data. A field
   * is deprecated, never lost.
   */
  it('leaves an unknown type exactly as found', () => {
    const stored = { id: 'c1', type: 'teleporter', target: 'x' } as unknown as ComponentDoc;
    expect(fillComponent(registries, stored)).toBe(stored);
  });

  it('is what the scene migration goes through', () => {
    const entity = createEntity('Thing', [{ id: 'c1', type: 'light' } as unknown as ComponentDoc]);
    const scene: SceneDoc = {
      version: SCENE_FORMAT_VERSION,
      id: fixedId('scene', 's1'),
      name: 'Main',
      entities: new Map([[entity.entity.id, entity.entity]]),
      components: new Map(),
      unknownComponents: new Map(),
      rootOrder: [entity.entity.id],
      environment: { background: '#000000' } as SceneDoc['environment'],
    };
    setComponentsOf(scene, entity.entity.id, entity.components);
    // A type no module here defines cannot be filed by `putComponent`: it
    // arrives from a file's own table, so that is where this one is put.
    const file = JSON.parse(serializeScene(registries, scene));
    const stored = { id: 'c2', type: 'teleporter', target: 'x' };
    file.components['teleporter'] = { [entity.entity.id]: { c2: stored } };

    const loaded = deserializeScene(registries, JSON.stringify(file));
    const [light] = componentsOf(registries, loaded, entity.entity.id);
    expect(light).toMatchObject({ type: 'light', intensity: expect.any(Number) });

    // Kept apart, since no type here claims it — and copied through byte for
    // byte, which is the rule that matters.
    expect(loaded.unknownComponents.get(fixedId('componentType', 'teleporter'))).toEqual(
      new Map([[entity.entity.id, new Map([['c2', stored]])]]),
    );
    expect(JSON.parse(serializeScene(registries, loaded)).components['teleporter']).toEqual({
      [entity.entity.id]: { c2: stored },
    });
  });
});

describe('assets', () => {
  it('names the material and every texture slot of a mesh', () => {
    const colour = fixedId('asset', 'tex-colour');
    const normal = fixedId('asset', 'tex-normal');
    const material = fixedId('asset', 'mat-1');
    const mesh = createMeshComponent('box');
    mesh.material.colorMap = colour;
    mesh.material.normalMap = normal;
    mesh.materialId = material;

    const named = componentAssets(registries, mesh);
    expect(named).toContain(material);
    expect(named).toContain(colour);
    expect(named).toContain(normal);
  });

  it('names nothing for a type that points at no asset', () => {
    expect(componentAssets(registries, createRigidBody())).toEqual([]);
  });

  it('names nothing for an unknown type rather than guessing', () => {
    const stored = { id: 'c1', type: 'teleporter', assetId: 'a1' } as unknown as ComponentDoc;
    expect(componentAssets(registries, stored)).toEqual([]);
  });
});

describe('createComponentForEntity', () => {
  it('shapes a collider from the mesh it joins', () => {
    const entity = createMeshEntity('sphere');
    const collider = createComponentForEntity(registries, 'collider', entity.components);
    expect(collider).toMatchObject({ shape: { kind: 'sphere', radius: 0.5 } });
  });

  it('is the plain factory for every other type', () => {
    const entity = createMeshEntity('box');
    expect(createComponentForEntity(registries, 'light', entity.components).type).toBe('light');
  });
});

/*
 * The facet the registry adds, and the reason it was worth writing.
 *
 * `audioSource` and `audioListener` were in the schema, in the defaults, in the
 * inspector and in reference extraction — and nothing played a sound. The
 * components were editable and did nothing. Eight separate files cannot show
 * that; a value can, and this test is what makes the list impossible to grow
 * quietly: a type added with no system either arrives here or arrives claiming a
 * system it does not have, and `componentCoverage.test.ts` catches that.
 *
 * Audio was that gap, and it is closed: both types now build a voice
 * through a behaviour of their own. The list is empty, and the test stays — it is
 * what will name the next type someone adds to the schema and forgets to give a
 * runtime, which is the failure this whole registry exists to make visible.
 */
describe('types with no runtime', () => {
  it('is empty: every authorable component builds something', () => {
    expect([...typesWithoutRuntime(registries)].sort()).toEqual([]);
  });
});
