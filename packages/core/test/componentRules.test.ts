import {
  audioListenerType,
  audioSourceType,
  cameraType,
  componentFits,
  componentsToAdd,
  createCoreRegistries,
  createEntity,
  createMeshEntity,
  createModelEntity,
  createPrefabInstance,
  colliderType,
  expandPrefabs,
  fixedId,
  lightType,
  meshType,
  modelType,
  rigidbodyType,
  type ComponentDefinition,
  type ComponentDoc,
  type ComponentTypeId,
  type CoreRegistries,
  type EntityTemplate,
  type SceneDoc,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { nest, prefabWith, sceneWith } from './fixtures';
import { builtInRegistries } from './registries';

/*
 * What each type declares about the others on its entity — what it requires,
 * what it excludes, whether it stacks — read in one place, for the menu that
 * offers a type and for the command that adds it.
 */

const registries = builtInRegistries();

/** Registries holding these definitions alone, for a type declaring what no built-in does. */
function registriesOf(...definitions: readonly ComponentDefinition[]): CoreRegistries {
  const made = createCoreRegistries();
  for (const definition of definitions) made.components.register(definition);
  return made;
}

/** What adding `type` to `template` puts on it, the scene being `scene`; `null` when refused. */
function adding(
  type: ComponentTypeId,
  template: EntityTemplate,
  scene: SceneDoc = sceneWith([template]),
  using: CoreRegistries = registries,
): readonly ComponentDoc[] | null {
  return componentsToAdd(using, { scene, entityId: template.entity.id, type, held: template.components });
}

/** The types of what `adding` answers, in the order it puts them. */
function typesAdding(...args: Parameters<typeof adding>): ComponentTypeId[] | null {
  return adding(...args)?.map((component) => component.type) ?? null;
}

/** The one component of `type` among `components`. */
function one(components: readonly ComponentDoc[] | null, type: ComponentTypeId): ComponentDoc | undefined {
  return components?.find((component) => component.type === type);
}

describe('componentFits', () => {
  const present = (...types: ComponentTypeId[]): ReadonlySet<ComponentTypeId> => new Set(types);

  it('refuses a mesh beside a model, and a model beside a mesh, though only the mesh says so', () => {
    expect(componentFits(registries, 'mesh', present('model'))).toBe(false);
    expect(componentFits(registries, 'model', present('mesh'))).toBe(false);
    expect(componentFits(registries, 'mesh', present('collider', 'script'))).toBe(true);
  });

  it('refuses a second of a type that does not stack, a Camera', () => {
    expect(componentFits(registries, 'camera', present('camera'))).toBe(false);
    expect(componentFits(registries, 'camera', present('light'))).toBe(true);
  });

  it('lets a second Collider and a second Script join', () => {
    expect(componentFits(registries, 'collider', present('collider', 'rigidbody'))).toBe(true);
    expect(componentFits(registries, 'script', present('script'))).toBe(true);
  });

  it('refuses a type the registries do not hold: nothing could make one', () => {
    expect(componentFits(registriesOf(meshType), 'camera', present())).toBe(false);
  });
});

describe('the companions a player controller brings', () => {
  it('brings a person-sized capsule and a kinematic body to an entity with nothing to measure', () => {
    const components = adding('playerController', createEntity('Player'));

    expect(components?.map((component) => component.type)).toEqual(['playerController', 'collider', 'rigidbody']);
    // 1.70 m standing, which the controller's eye height is chosen against.
    expect(one(components, 'collider')).toMatchObject({ shape: { kind: 'capsule', radius: 0.3, height: 1.7 } });
    // Moved by the controller, not by forces, which would fight the input.
    expect(one(components, 'rigidbody')).toMatchObject({ bodyType: 'kinematicPosition' });
  });

  it('keeps the shape guessed from a mesh or a model the author can see', () => {
    expect(one(adding('playerController', createMeshEntity('sphere')), 'collider')).toMatchObject({
      shape: { kind: 'sphere', radius: 0.5 },
    });
    const model = createModelEntity(fixedId('asset', 'hero'), 'Hero');
    expect(one(adding('playerController', model), 'collider')).toMatchObject({
      shape: { kind: 'mesh', build: 'triangles' },
    });
  });
});

describe('the companions a rigid body brings', () => {
  const withCollider = (name: string): EntityTemplate => createEntity(name, [colliderType.create()]);

  it('brings a Collider guessed from the entity\'s mesh', () => {
    const cube = createMeshEntity('box');
    const components = adding('rigidbody', cube);

    expect(components?.map((component) => component.type)).toEqual(['rigidbody', 'collider']);
    expect(one(components, 'collider')).toMatchObject({ shape: { kind: 'box', size: [1, 1, 1] } });
    expect(one(components, 'rigidbody')).toMatchObject({ bodyType: 'dynamic' });
  });

  it('brings none to an entity whose children carry colliders, which ride it', () => {
    const wheels = [withCollider('Wheel'), withCollider('Wheel')];
    const cart = nest(createEntity('Cart'), ...wheels);

    expect(typesAdding('rigidbody', cart, sceneWith([cart, ...wheels]))).toEqual(['rigidbody']);
  });

  it('counts no child that has a body of its own', () => {
    const trailer = createEntity('Trailer', [rigidbodyType.create(), colliderType.create()]);
    const cart = nest(createEntity('Cart'), trailer);

    expect(typesAdding('rigidbody', cart, sceneWith([cart, trailer]))).toEqual(['rigidbody', 'collider']);
  });

  it('counts the colliders of a prefab placed under it, in the expanded scene', () => {
    const crate = withCollider('Crate');
    const CRATE = fixedId('asset', 'crate');
    const prefabs = new Map([[CRATE, { ...prefabWith('Crate', [crate], crate.entity.id), id: CRATE }]]);
    const placed = createEntity('Crate', [createPrefabInstance(CRATE)]);
    const cart = nest(createEntity('Cart'), placed);
    const scene = sceneWith([cart, placed]);

    expect(typesAdding('rigidbody', cart, scene)).toEqual(['rigidbody', 'collider']);
    expect(typesAdding('rigidbody', cart, expandPrefabs(registries, scene, prefabs).scene)).toEqual(['rigidbody']);
  });
});

describe('the companions a joint brings', () => {
  it('brings a dynamic Rigid Body to a Cube, and that body its Collider', () => {
    const components = adding('joint', createMeshEntity('box'));

    expect(components?.map((component) => component.type)).toEqual(['joint', 'rigidbody', 'collider']);
    expect(one(components, 'rigidbody')).toMatchObject({ bodyType: 'dynamic' });
    expect(one(components, 'collider')).toMatchObject({ shape: { kind: 'box' } });
  });

  it('brings none to a child of a body, which moves with it', () => {
    const hinge = createEntity('Hinge');
    const door = nest(createEntity('Door', [rigidbodyType.create(), colliderType.create()]), hinge);

    expect(typesAdding('joint', hinge, sceneWith([door, hinge]))).toEqual(['joint']);
  });

  it('brings none beside a Rigid Body, and asks nothing of the body it finds', () => {
    // The body has no collider: one is brought with a body, never to one.
    expect(typesAdding('joint', createEntity('Cart', [rigidbodyType.create()]))).toEqual(['joint']);
  });
});

describe('what is refused', () => {
  it('answers `null` for a type that does not fit, and adds nothing', () => {
    expect(adding('mesh', createModelEntity(fixedId('asset', 'chair'), 'Chair'))).toBeNull();
    expect(adding('camera', createEntity('Eye', [cameraType.create()]))).toBeNull();
  });

  it('answers `null` when a companion does not fit, rather than bringing the others', () => {
    const lamp = { ...lightType, requires: [{ type: 'mesh' }] } satisfies ComponentDefinition;
    const using = registriesOf(meshType, modelType, lamp);
    const chair = createModelEntity(fixedId('asset', 'chair'), 'Chair');

    expect(adding('light', chair, sceneWith([chair]), using)).toBeNull();
  });

  it('throws on a requirement no activation registered: the type is defined wrong for this build', () => {
    const watcher = { ...cameraType, requires: [{ type: 'light' }] } satisfies ComponentDefinition;

    expect(() => adding('camera', createEntity('Eye'), undefined, registriesOf(watcher))).toThrow('"light"');
  });
});

describe('a requirement any type declares', () => {
  it('brings the type it names, through that type\'s own factory', () => {
    const watcher = { ...cameraType, requires: [{ type: 'light' }] } satisfies ComponentDefinition;
    const using = registriesOf(watcher, lightType);

    expect(typesAdding('camera', createEntity('Eye'), undefined, using)).toEqual(['camera', 'light']);
  });

  it('stops where two types require each other: each brings the other once', () => {
    const using = registriesOf(
      { ...audioSourceType, requires: [{ type: 'audioListener' }] },
      { ...audioListenerType, requires: [{ type: 'audioSource' }] },
    );

    expect(typesAdding('audioSource', createEntity('Radio'), undefined, using)).toEqual(['audioSource', 'audioListener']);
  });
});

