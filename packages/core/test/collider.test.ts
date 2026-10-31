import {
  GEOMETRY_LABELS,
  colliderGeometry,
  createColliderShape,
  createComponent,
  createComponentForEntity,
  createMeshEntity,
  createModelEntity,
  originAboveFeet,
  type ColliderShape,
  type GeometryKind,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';

/*
 * How far a collider hangs below the entity's origin.
 *
 * Two things read this and they must not disagree: the scene migration that
 * raised every stored `eyeHeight` to be measured from the feet, and the
 * controller that places the camera at run time. A difference between them
 * would show up as a camera that sits at one height in a freshly migrated
 * project and another height the next time the scene is opened — the sort of
 * drift nobody traces back to a shape table.
 */

describe('originAboveFeet', () => {
  it('measures a box by half its height', () => {
    // A box is measured as drawn: 1.8 m tall reaches 0.9 m below its middle.
    expect(originAboveFeet({ kind: 'box', size: [0.8, 1.8, 0.8] })).toBe(0.9);
  });

  it('measures a sphere by its radius', () => {
    expect(originAboveFeet({ kind: 'sphere', radius: 0.6 })).toBe(0.6);
  });

  it('measures a capsule by half its height, caps included', () => {
    // The default player: 1.70 m standing, so the origin — the middle — is
    // 0.85 m above the floor.
    expect(originAboveFeet({ ...createColliderShape('capsule'), radius: 0.3, height: 1.7 })).toBeCloseTo(
      0.85,
      6,
    );
  });

  it('measures a capsule shorter than its diameter as the sphere as tall as it is drawn', () => {
    expect(originAboveFeet({ ...createColliderShape('capsule'), radius: 0.5, height: 0.6 })).toBeCloseTo(
      0.3,
      6,
    );
  });

  for (const build of ['triangles', 'hull'] as const) {
    it(`treats the origin of a mesh built as ${build} as already being its reference`, () => {
      // Built from the entity's own geometry in its own local space, so there
      // is nothing centred on the origin to compensate for — and no answer the
      // migration, which has no geometry to measure, could give instead.
      expect(originAboveFeet({ kind: 'mesh', build })).toBe(0);
    });
  }
});

/*
 * What physics builds of a shape at an entity's scale: Rapier has no scaled
 * shape, so every rule of how a scale stretches a collider is one of these.
 */
describe('colliderGeometry', () => {
  const capsule = (): ColliderShape => ({ ...createColliderShape('capsule'), radius: 0.3, height: 1.7 });

  it('stretches each axis of a box by the scale along it', () => {
    expect(colliderGeometry({ kind: 'box', size: [2, 1, 4] }, [1, 2, 0.5]).shape).toEqual({
      kind: 'box',
      halfExtents: [1, 1, 1],
    });
  });

  it('grows a sphere by the largest stretch, so it encloses what is drawn', () => {
    expect(colliderGeometry({ kind: 'sphere', radius: 0.5 }, [1, 3, 2]).shape).toEqual({
      kind: 'sphere',
      radius: 1.5,
    });
  });

  it('keeps a capsule’s span as drawn when it is stretched along its length', () => {
    const { shape } = colliderGeometry(capsule(), [1, 2, 1]);
    expect(shape.kind).toBe('capsule');
    if (shape.kind !== 'capsule') return;
    expect(shape.radius).toBeCloseTo(0.3, 6);
    expect(shape.halfHeight).toBeCloseTo(1.4, 6);
  });

  it('widens a capsule by its section’s larger stretch, its span kept', () => {
    const { shape } = colliderGeometry(capsule(), [2, 1, 2]);
    expect(shape.kind).toBe('capsule');
    if (shape.kind !== 'capsule') return;
    expect(shape.radius).toBeCloseTo(0.6, 6);
    expect(shape.halfHeight).toBeCloseTo(0.25, 6);
  });

  it('builds a capsule squashed wider than it is tall as the sphere as tall as it is drawn', () => {
    const { shape } = colliderGeometry(capsule(), [3, 1, 3]);
    expect(shape.kind).toBe('sphere');
    if (shape.kind !== 'sphere') return;
    expect(shape.radius).toBeCloseTo(0.85, 6);
  });

  it('builds the same shape mirrored', () => {
    const shapes: ColliderShape[] = [{ kind: 'box', size: [2, 1, 4] }, { kind: 'sphere', radius: 0.5 }, capsule()];
    for (const shape of shapes) {
      expect(colliderGeometry(shape, [-1, 2, -0.5])).toEqual(colliderGeometry(shape, [1, 2, 0.5]));
    }
  });

  it('builds a negative measure, which only a hand-edited file holds, as none', () => {
    expect(colliderGeometry({ kind: 'box', size: [-2, 1, 4] }, [1, 1, 1]).shape).toEqual({
      kind: 'box',
      halfExtents: [0, 0.5, 2],
    });
    expect(colliderGeometry({ kind: 'sphere', radius: -1 }, [1, 1, 1]).shape).toEqual({
      kind: 'sphere',
      radius: 0,
    });
  });

  it('hands a mesh its own build and the signed scale its vertices take', () => {
    expect(colliderGeometry({ kind: 'mesh', build: 'hull' }, [-1, 2, 3]).shape).toEqual({
      kind: 'mesh',
      build: 'hull',
      scale: [-1, 2, 3],
    });
  });
});

describe('createColliderFor', () => {
  const isGeometryKind = (kind: string): kind is GeometryKind => Object.hasOwn(GEOMETRY_LABELS, kind);
  const guessed = (kind: GeometryKind): ColliderShape => {
    const template = createMeshEntity(kind);
    return createComponentForEntity('collider', template.components).shape;
  };

  it('guesses each primitive’s collider as it is drawn', () => {
    // A record over every primitive, so one added later has to answer here.
    const expected: Record<GeometryKind, ColliderShape> = {
      box: { kind: 'box', size: [1, 1, 1] },
      sphere: { kind: 'sphere', radius: 0.5 },
      // three's capsule height is its straight part: 1 + two caps of 0.5.
      capsule: { kind: 'capsule', radius: 0.5, height: 2 },
      // A capsule still, as before cylinders had a collider of their own.
      cylinder: { kind: 'capsule', radius: 0.5, height: 2 },
      plane: { kind: 'mesh', build: 'triangles' },
      circle: { kind: 'mesh', build: 'triangles' },
      ring: { kind: 'mesh', build: 'triangles' },
      torus: { kind: 'mesh', build: 'triangles' },
      torusKnot: { kind: 'mesh', build: 'triangles' },
      tetrahedron: { kind: 'mesh', build: 'hull' },
      octahedron: { kind: 'mesh', build: 'hull' },
      dodecahedron: { kind: 'mesh', build: 'hull' },
      icosahedron: { kind: 'mesh', build: 'hull' },
    };
    for (const [kind, shape] of Object.entries(expected)) {
      if (!isGeometryKind(kind)) throw new Error(`not a primitive: ${kind}`);
      expect({ kind, shape: guessed(kind) }).toEqual({ kind, shape });
    }
  });

  it('guesses a tapered cylinder as the capsule of its wider end', () => {
    for (const [radiusTop, radiusBottom] of [[0, 0.5], [0.5, 0], [0.2, 0.5]] as const) {
      const template = createMeshEntity('cylinder');
      const mesh = template.components[0]!;
      if (mesh.type !== 'mesh' || mesh.geometry.kind !== 'cylinder') throw new Error('not a cylinder');
      mesh.geometry = { ...mesh.geometry, radiusTop, radiusBottom };
      expect(createComponentForEntity('collider', template.components).shape).toEqual({
        kind: 'capsule',
        radius: 0.5,
        height: 2,
      });
    }
  });

  it('gives a model a mesh collider built from its triangles', () => {
    const model = createModelEntity('asset-1', 'Tree');
    expect(createComponentForEntity('collider', model.components).shape).toEqual({
      kind: 'mesh',
      build: 'triangles',
    });
  });
});
