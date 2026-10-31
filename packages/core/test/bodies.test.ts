import {
  bodyOf,
  collidersOfBody,
  createComponent,
  createEntity,
  createPrefabInstance,
  entityWorldMatrixPath,
  expandPrefabs,
  instancedId,
  physicsBodies,
  type EntityTemplate,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { nest, prefabWith, sceneWith } from './fixtures';

/*
 * Which body each collider rides: the nearest Rigid Body up the tree, or, with
 * none above it, a fixed body of its own entity.
 */

const withRigidBody = (name: string) => createEntity(name, [createComponent('rigidbody')]);
const withCollider = (name: string) => createEntity(name, [createComponent('collider')]);

/**
 * A, a body, carrying B and B's child C; under A, D with a body and a collider
 * of its own, and E under D; F, level geometry; G, a body with nothing on it.
 */
function tree(): Record<'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G', EntityTemplate> {
  const parts = {
    A: withRigidBody('A'),
    B: withCollider('B'),
    C: withCollider('C'),
    D: createEntity('D', [createComponent('rigidbody'), createComponent('collider')]),
    E: withCollider('E'),
    F: withCollider('F'),
    G: withRigidBody('G'),
  };
  nest(parts.A, nest(parts.B, parts.C), nest(parts.D, parts.E));
  return parts;
}

describe('physicsBodies', () => {
  it('rides each collider on the nearest Rigid Body up the tree, its own entity’s included', () => {
    const parts = tree();
    const bodies = physicsBodies(sceneWith(Object.values(parts)));

    const carried = (name: keyof typeof parts) => new Set(bodies.get(parts[name].entity.id));
    const ids = (...names: (keyof typeof parts)[]) => new Set(names.map((name) => parts[name].entity.id));
    expect(bodies.size).toBe(4);
    expect(carried('A')).toEqual(ids('B', 'C'));
    expect(carried('D')).toEqual(ids('D', 'E'));
    expect(carried('F')).toEqual(ids('F'));
    expect(carried('G')).toEqual(ids());
  });

  it('walks up, so a prefab’s contents ride the body that placed them', () => {
    const crate = withCollider('Crate');
    const prefab = prefabWith('Crate', [crate], crate.entity.id);
    const cart = withRigidBody('Cart');
    const placed = createEntity('Placed', [createPrefabInstance('prefab-1')]);
    nest(cart, placed);

    const { scene } = expandPrefabs(sceneWith([cart, placed]), {
      get: (id) => (id === 'prefab-1' ? prefab : undefined),
    });

    // The copy names the entity that placed it as its parent, which does not
    // name it back: a walk down from the cart would miss it.
    const copy = instancedId(placed.entity.id, crate.entity.id);
    expect(scene.entities[placed.entity.id]?.children).not.toContain(copy);
    expect(physicsBodies(scene).get(cart.entity.id)).toEqual([copy]);
  });

  it('reads only the colliders and what lies above them', () => {
    const parts = Object.values(tree());
    const props = Array.from({ length: 200 }, (_, i) => createEntity(`Prop ${i}`));
    const scene = sceneWith([...parts, ...props]);
    const read = new Set<string | symbol>();
    const watched = {
      ...scene,
      entities: new Proxy(scene.entities, {
        get(target, key, receiver) {
          read.add(key);
          return Reflect.get(target, key, receiver);
        },
      }),
    };

    physicsBodies(watched);

    const colliders = Object.keys(scene.components.collider);
    const above = new Set(colliders.flatMap((id) => entityWorldMatrixPath(scene, id)));
    expect(read.size).toBeGreaterThan(0);
    for (const key of read) expect(above).toContain(key);
  });
});

describe('bodyOf', () => {
  it('names the body a collider rides', () => {
    const parts = tree();
    const scene = sceneWith(Object.values(parts));

    const body = (name: keyof typeof parts) => bodyOf(scene, parts[name].entity.id);
    expect(body('B')).toBe(parts.A.entity.id);
    expect(body('C')).toBe(parts.A.entity.id);
    expect(body('D')).toBe(parts.D.entity.id);
    expect(body('E')).toBe(parts.D.entity.id);
    expect(body('F')).toBeNull();
    expect(body('G')).toBe(parts.G.entity.id);
  });

  it('walks up, so a prefab’s root placed under a body rides it', () => {
    const crate = withCollider('Crate');
    const prefab = prefabWith('Crate', [crate], crate.entity.id);
    const cart = withRigidBody('Cart');
    const placed = createEntity('Placed', [createPrefabInstance('prefab-1')]);
    nest(cart, placed);

    const { scene } = expandPrefabs(sceneWith([cart, placed]), {
      get: (id) => (id === 'prefab-1' ? prefab : undefined),
    });

    expect(bodyOf(scene, instancedId(placed.entity.id, crate.entity.id))).toBe(cart.entity.id);
  });
});

describe('collidersOfBody', () => {
  it('answers for a body not added yet', () => {
    const h = createEntity('H');
    const i = withCollider('I');
    const j = withRigidBody('J');
    const k = withCollider('K');
    nest(h, i, nest(j, k));

    expect(collidersOfBody(sceneWith([h, i, j, k]), h.entity.id)).toEqual([i.entity.id]);
  });
});
