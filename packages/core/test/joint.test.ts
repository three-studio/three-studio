import {
  createJoint,
  createJointMotion,
  fillComponent,
  jointFrame,
  type ComponentDoc,
  type JointComponent,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { close } from './fixtures';

/*
 * A joint, read as physics data is: against its factory, its motion against the
 * factory of the kind it names.
 */

describe('a stored joint', () => {
  it('reads a stored joint against its factory, field by field', () => {
    const stored = {
      id: 'j1',
      type: 'joint',
      motion: { kind: 'slider', axis: [1, 0, 0], stray: 1 },
      connectedEntity: 7,
      anchor: [0, 'x', 0],
      extra: true,
    } as unknown as ComponentDoc;

    expect(fillComponent(stored)).toEqual({
      ...createJoint(),
      id: 'j1',
      motion: { ...createJointMotion('slider'), axis: [1, 0, 0] },
    });
  });

  it('a kind this build does not know reads as a hinge', () => {
    for (const kind of ['ball', 'constructor', 7]) {
      const stored = { ...createJoint(), motion: { kind, axis: [1, 0, 0] } } as unknown as ComponentDoc;
      const filled = fillComponent(stored) as JointComponent;
      expect(filled.motion).toEqual(createJointMotion('hinge'));
    }
  });

  it('keeps the entity it names, and the world it is held to', () => {
    const named = fillComponent({ ...createJoint(), connectedEntity: 'frame' }) as JointComponent;
    expect(named.connectedEntity).toBe('frame');
    expect((fillComponent(createJoint()) as JointComponent).connectedEntity).toBeNull();
  });
});

describe('jointFrame', () => {
  const hinge = (axis: [number, number, number]): JointComponent => ({
    ...createJoint(),
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
      close(jointFrame({ ...createJoint(), motion: createJointMotion(kind) }, [1, 1, 1]).axis, [0, 1, 0]);
    }
  });
});
