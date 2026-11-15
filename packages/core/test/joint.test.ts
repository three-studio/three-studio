import {
  jointType,
  createJointMotion,
  fixedId,
  jointFrame,
  unwrap,
  type JointComponent,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { close } from './fixtures';

/*
 * A joint holds the entity it names, and the frame its two bodies are held in.
 */

describe('a stored joint', () => {
  it('keeps the entity it names, and the world it is held to', () => {
    const frame = fixedId('entity', 'frame');
    const stored = (joint: JointComponent) => unwrap(jointType.decode(JSON.parse(JSON.stringify(joint)), []), 'joint');
    expect(stored({ ...jointType.create(), connectedEntity: frame }).connectedEntity).toBe(frame);
    expect(stored(jointType.create()).connectedEntity).toBeNull();
  });
});

describe('jointFrame', () => {
  const hinge = (axis: [number, number, number]): JointComponent => ({
    ...jointType.create(),
    motion: { ...createJointMotion('hinge'), axis },
  });

  it("places the anchor at the entity's scale and makes the axis unit, unstretched", () => {
    const joint: JointComponent = { ...hinge([0, 0, 2]), anchor: [1, 1, 1] };
    close(jointFrame(joint, [1, 2, 0.5]).anchor, [1, 2, 0.5]);
    close(jointFrame(joint, [1, 1, 1]).axis, [0, 0, 1]);

    close(jointFrame(hinge([0, 0, 0]), [1, 1, 1]).axis, [0, 1, 0]);
    // Turned with its entity, never stretched: a door scaled tall keeps its
    // hinge where it was drawn.
    close(jointFrame(hinge([1, 1, 0]), [1, 3, 1]).axis, [Math.SQRT1_2, Math.SQRT1_2, 0]);
  });

  it('turns nothing for a Fixed or a Spring joint, whose frame is up', () => {
    for (const kind of ['fixed', 'spring'] as const) {
      close(jointFrame({ ...jointType.create(), motion: createJointMotion(kind) }, [1, 1, 1]).axis, [0, 1, 0]);
    }
  });
});
