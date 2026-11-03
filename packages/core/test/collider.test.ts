import {
  GEOMETRY_LABELS,
  colliderGeometry,
  createColliderShape,
  createComponent,
  createComponentForEntity,
  createMeshEntity,
  createModelEntity,
  createPhysicsMaterial,
  fillComponent,
  fitColliderShape,
  linkedPhysicsMaterial,
  originAboveFeet,
  type BodyType,
  type ColliderComponent,
  type ColliderShape,
  type ComponentDoc,
  type GeometryKind,
  type MeshBuild,
  type Vec3,
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
    expect(originAboveFeet({ ...createColliderShape('box'), size: [0.8, 1.8, 0.8] })).toBe(0.9);
  });

  it('measures a sphere by its radius', () => {
    expect(originAboveFeet({ ...createColliderShape('sphere'), radius: 0.6 })).toBe(0.6);
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

  it('measures a cylinder and a cone by half their height', () => {
    expect(originAboveFeet({ ...createColliderShape('cylinder'), radius: 0.4, height: 1.2 })).toBeCloseTo(0.6, 6);
    // Upright, a cone reaches as far below its middle, at its base, as its apex
    // does above it.
    expect(originAboveFeet({ ...createColliderShape('cone'), radius: 0.4, height: 1.2 })).toBeCloseTo(0.6, 6);
  });

  it('is not moved by a rounding when the shape is not turned', () => {
    for (const kind of ['box', 'cylinder', 'cone'] as const) {
      const sharp = createColliderShape(kind);
      expect(originAboveFeet({ ...sharp, rounding: 0.1 })).toBeCloseTo(originAboveFeet(sharp), 6);
    }
  });

  it('turns a shape as three turns an Euler XYZ', () => {
    // Rx · Rz stands the box's 3 m depth upright; Rz · Rx, the order three
    // calls ZYX, would stand its 1 m width there instead.
    const box: ColliderShape = {
      ...createColliderShape('box'),
      size: [1, 2, 3],
      rotation: [Math.PI / 2, 0, Math.PI / 2],
    };
    expect(originAboveFeet(box)).toBeCloseTo(1.5, 6);
  });

  it('reaches a cone’s rim when it is tilted, its apex being up', () => {
    const tilt = Math.PI / 6;
    const cone: ColliderShape = { ...createColliderShape('cone'), radius: 0.4, height: 1.2, rotation: [0, 0, tilt] };
    // Apex down, it would reach 0.6 · cos 30° below, at its tip.
    expect(originAboveFeet(cone)).toBeCloseTo(
      0.6 * Math.cos(tilt) + 0.4 * Math.sin(tilt),
      6,
    );
  });

  it('answers 0 for a capsule whose centre stands it on the origin', () => {
    const capsule: ColliderShape = {
      ...createColliderShape('capsule'),
      radius: 0.3,
      height: 1.7,
      center: [0, 0.85, 0],
    };
    expect(originAboveFeet(capsule)).toBeCloseTo(0, 6);
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
    expect(colliderGeometry({ ...createColliderShape('box'), size: [2, 1, 4] }, [1, 2, 0.5], undefined).shape).toEqual({
      kind: 'box',
      halfExtents: [1, 1, 1],
      rounding: 0,
    });
  });

  it('grows a sphere by the largest stretch, so it encloses what is drawn', () => {
    expect(colliderGeometry({ ...createColliderShape('sphere'), radius: 0.5 }, [1, 3, 2], undefined).shape).toEqual({
      kind: 'sphere',
      radius: 1.5,
    });
  });

  it('keeps a capsule’s span as drawn when it is stretched along its length', () => {
    const { shape } = colliderGeometry(capsule(), [1, 2, 1], undefined);
    expect(shape.kind).toBe('capsule');
    if (shape.kind !== 'capsule') return;
    expect(shape.radius).toBeCloseTo(0.3, 6);
    expect(shape.halfHeight).toBeCloseTo(1.4, 6);
  });

  it('widens a capsule by its section’s larger stretch, its span kept', () => {
    const { shape } = colliderGeometry(capsule(), [2, 1, 2], undefined);
    expect(shape.kind).toBe('capsule');
    if (shape.kind !== 'capsule') return;
    expect(shape.radius).toBeCloseTo(0.6, 6);
    expect(shape.halfHeight).toBeCloseTo(0.25, 6);
  });

  it('builds a capsule squashed wider than it is tall as the sphere as tall as it is drawn', () => {
    const { shape } = colliderGeometry(capsule(), [3, 1, 3], undefined);
    expect(shape.kind).toBe('sphere');
    if (shape.kind !== 'sphere') return;
    expect(shape.radius).toBeCloseTo(0.85, 6);
  });

  it('stretches a cylinder and a cone along their length, their section by its larger stretch', () => {
    for (const kind of ['cylinder', 'cone'] as const) {
      const shape = { ...createColliderShape(kind), radius: 0.5, height: 1 };
      expect(colliderGeometry(shape, [1, 3, 2], undefined).shape).toEqual({
        kind,
        radius: 1,
        halfHeight: 1.5,
        rounding: 0,
      });
    }
  });

  it('stretches a turned box along its own axes', () => {
    // Turned a quarter about z, its 3 m height lies along the entity's x.
    const box: ColliderShape = { ...createColliderShape('box'), size: [1, 3, 1], rotation: [0, 0, Math.PI / 2] };
    const { shape, rotation } = colliderGeometry(box, [2, 1, 1], undefined);
    expect(shape.kind).toBe('box');
    if (shape.kind !== 'box') return;
    expect(shape.halfExtents[0]).toBeCloseTo(0.5, 6);
    expect(shape.halfExtents[1]).toBeCloseTo(3, 6);
    expect(shape.halfExtents[2]).toBeCloseTo(0.5, 6);
    expect(rotation).toEqual([0, 0, Math.PI / 2]);
  });

  it('sets a shape off its entity’s centre by the centre at the entity’s scale', () => {
    const sphere: ColliderShape = { ...createColliderShape('sphere'), center: [1, 2, 3] };
    expect(colliderGeometry(sphere, [2, 1, -1], undefined).position).toEqual([2, 2, -3]);
  });

  it('rounds a box inside its drawn size, the core and the rounding apart', () => {
    const box: ColliderShape = { ...createColliderShape('box'), rounding: 0.1 };
    const { shape } = colliderGeometry(box, [1, 1, 1], undefined);
    expect(shape.kind).toBe('box');
    if (shape.kind !== 'box') return;
    expect(shape.halfExtents.map((h) => h.toFixed(6))).toEqual(['0.400000', '0.400000', '0.400000']);
    expect(shape.rounding).toBeCloseTo(0.1, 6);
  });

  it('stretches a rounding by the least the shape is stretched', () => {
    const box: ColliderShape = { ...createColliderShape('box'), rounding: 0.1 };
    const { shape } = colliderGeometry(box, [1, 0.1, 1], undefined);
    if (shape.kind !== 'box') throw new Error('not a box');
    expect(shape.rounding).toBeCloseTo(0.01, 6);
    expect(shape.halfExtents[1]).toBeCloseTo(0.04, 6);
  });

  it('caps a rounding at the smallest half measure', () => {
    for (const kind of ['box', 'cylinder', 'cone'] as const) {
      const { shape } = colliderGeometry({ ...createColliderShape(kind), rounding: 2 }, [1, 1, 1], undefined);
      if (shape.kind === 'sphere' || shape.kind === 'capsule' || shape.kind === 'mesh') {
        throw new Error(`not rounded: ${shape.kind}`);
      }
      // 1 m across and 1 m tall: never more than half a metre, its core a point.
      expect(shape.rounding).toBeCloseTo(0.5, 6);
    }
  });

  it('builds the same shape mirrored', () => {
    const shapes: ColliderShape[] = [
      { ...createColliderShape('box'), size: [2, 1, 4] },
      { ...createColliderShape('sphere'), radius: 0.5 },
      capsule(),
    ];
    for (const shape of shapes) {
      expect(colliderGeometry(shape, [-1, 2, -0.5], undefined).shape).toEqual(colliderGeometry(shape, [1, 2, 0.5], undefined).shape);
    }
  });

  it('builds a negative measure, which only a hand-edited file holds, as none', () => {
    expect(colliderGeometry({ ...createColliderShape('box'), size: [-2, 1, 4] }, [1, 1, 1], undefined).shape).toEqual({
      kind: 'box',
      halfExtents: [0, 0.5, 2],
      rounding: 0,
    });
    expect(colliderGeometry({ ...createColliderShape('sphere'), radius: -1 }, [1, 1, 1], undefined).shape).toEqual({
      kind: 'sphere',
      radius: 0,
    });
  });

  it('builds a dynamic body’s triangles as their hull, and leaves every other build alone', () => {
    const build = (mesh: MeshBuild, bodyType?: BodyType) => {
      const { shape } = colliderGeometry({ kind: 'mesh', build: mesh }, [1, 1, 1], bodyType);
      return shape.kind === 'mesh' ? shape.build : null;
    };
    expect(build('triangles', 'dynamic')).toBe('hull');
    expect(build('hull', 'dynamic')).toBe('hull');
    expect(build('parts', 'dynamic')).toBe('parts');
    expect(build('triangles', 'fixed')).toBe('triangles');
    expect(build('triangles', 'kinematicPosition')).toBe('triangles');
    expect(build('triangles')).toBe('triangles');
  });

  it('hands a mesh its own build and the signed scale its vertices take', () => {
    expect(colliderGeometry({ kind: 'mesh', build: 'hull' }, [-1, 2, 3], undefined).shape).toEqual({
      kind: 'mesh',
      build: 'hull',
      scale: [-1, 2, 3],
    });
  });
});

describe('fitColliderShape', () => {
  /** The eight corners of a box of this size, centred on `middle`, as x, y, z triples. */
  const corners = ([x, y, z]: Vec3, [mx, my, mz]: Vec3): number[] =>
    [-1, 1].flatMap((sx) =>
      [-1, 1].flatMap((sy) => [-1, 1].flatMap((sz) => [mx + (sx * x) / 2, my + (sy * y) / 2, mz + (sz * z) / 2])),
    );

  /** Within a millionth, axis by axis. */
  const expectNear = (actual: readonly number[], expected: readonly number[]): void => {
    expect(actual).toHaveLength(expected.length);
    actual.forEach((value, i) => expect(Math.abs(value - (expected[i] ?? Number.NaN))).toBeLessThan(1e-6));
  };

  it('fits each kind around what the vertices span', () => {
    const block = corners([2, 1, 4], [0, 0.5, 0]);

    const box = fitColliderShape(createColliderShape('box'), block);
    if (box.kind !== 'box') throw new Error('not a box');
    expectNear(box.size, [2, 1, 4]);
    expectNear(box.center, [0, 0.5, 0]);

    const sphere = fitColliderShape(createColliderShape('sphere'), block);
    if (sphere.kind !== 'sphere') throw new Error('not a sphere');
    // Unity's rule: a sphere fitted to a cube touches its faces.
    expect(sphere.radius).toBeCloseTo(2, 6);
    expectNear(sphere.center, [0, 0.5, 0]);

    for (const kind of ['capsule', 'cylinder', 'cone'] as const) {
      const fitted = fitColliderShape(createColliderShape(kind), block);
      if (fitted.kind !== kind) throw new Error(`not a ${kind}`);
      expect(fitted.radius).toBeCloseTo(2, 6);
      expect(fitted.height).toBeCloseTo(1, 6);
      expectNear(fitted.center, [0, 0.5, 0]);
    }
  });

  it('fits in the shape’s own frame, keeping its turn and its rounding', () => {
    const log = corners([4, 1, 1], [0, 0, 0]);
    const lying: ColliderShape = { ...createColliderShape('capsule'), rotation: [0, 0, Math.PI / 2] };

    const fitted = fitColliderShape(lying, log);
    if (fitted.kind !== 'capsule') throw new Error('not a capsule');
    expect(fitted.radius).toBeCloseTo(0.5, 6);
    expect(fitted.height).toBeCloseTo(4, 6);
    expect(fitted.rotation).toEqual([0, 0, Math.PI / 2]);
    expectNear(fitted.center, [0, 0, 0]);

    const rounded = fitColliderShape({ ...createColliderShape('box'), rounding: 0.1 }, log);
    expect(rounded.kind === 'box' && rounded.rounding).toBe(0.1);

    const mesh: ColliderShape = { kind: 'mesh', build: 'hull' };
    expect(fitColliderShape(mesh, log)).toEqual(mesh);
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
      box: { ...createColliderShape('box'), size: [1, 1, 1] },
      sphere: { ...createColliderShape('sphere'), radius: 0.5 },
      // three's capsule height is its straight part: 1 + two caps of 0.5.
      capsule: { ...createColliderShape('capsule'), radius: 0.5, height: 2 },
      // A cylinder, where it was a capsule a cap too tall at each end.
      cylinder: { ...createColliderShape('cylinder'), radius: 0.5, height: 1 },
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

  const tapered = (radiusTop: number, radiusBottom: number): ColliderShape => {
    const template = createMeshEntity('cylinder');
    const mesh = template.components[0]!;
    if (mesh.type !== 'mesh' || mesh.geometry.kind !== 'cylinder') throw new Error('not a cylinder');
    mesh.geometry = { ...mesh.geometry, radiusTop, radiusBottom };
    return createComponentForEntity('collider', template.components).shape;
  };

  it('guesses a cylinder whose top radius is 0 as a cone, apex up', () => {
    expect(tapered(0, 0.5)).toEqual({ ...createColliderShape('cone'), radius: 0.5, height: 1 });
  });

  it('guesses a cylinder whose bottom radius is 0 as a cone turned over', () => {
    expect(tapered(0.5, 0)).toEqual({
      ...createColliderShape('cone'),
      radius: 0.5,
      height: 1,
      rotation: [Math.PI, 0, 0],
    });
  });

  it('guesses any other tapered cylinder as its convex hull, which is exact', () => {
    expect(tapered(0.2, 0.5)).toEqual({ kind: 'mesh', build: 'hull' });
  });

  it('gives a model a mesh collider built from its triangles', () => {
    const model = createModelEntity('asset-1', 'Tree');
    expect(createComponentForEntity('collider', model.components).shape).toEqual({
      kind: 'mesh',
      build: 'triangles',
    });
  });
});

describe('a collider’s physics material', () => {
  it('a stored collider keeps the physics material it names, and reads anything else as none', () => {
    const stored = (fields: object) => {
      const component = { id: 'c1', type: 'collider', ...fields } as unknown as ComponentDoc;
      return fillComponent(component) as ColliderComponent;
    };

    expect(stored({ materialId: 'ice' }).materialId).toBe('ice');
    expect(stored({ materialId: 7 }).materialId).toBeNull();
    expect(stored({}).materialId).toBeNull();
  });

  it('a link finds only an asset its library holds as its own', () => {
    const ice = { ...createPhysicsMaterial(), friction: 0 };

    expect(linkedPhysicsMaterial('ice', { ice })).toBe(ice);
    // An id is read off a file, and `constructor` is what every object answers to.
    for (const id of [null, '', 'gone', 'constructor']) {
      expect(linkedPhysicsMaterial(id, { ice })).toBeNull();
    }
  });
});
