import { createEntity, createTransform } from '@three-studio/core';
import { describe, it } from 'vitest';
import { close, sceneWith } from '../../core/test/fixtures';
import { localTransformUnder, worldPosition } from '../src/commands/transformSpace';

/*
 * A transform is stored relative to its parent, so changing the parent changes
 * what the same numbers mean. Reparenting used to keep them, which teleported
 * whatever was dropped onto a parent that was not at the origin.
 */

describe('world placement', () => {
  it('accumulates position, rotation and scale down the chain', () => {
    const parent = createEntity('Parent');
    parent.entity.transform = { position: [5, 0, 0], rotation: [0, Math.PI / 2, 0], scale: [2, 2, 2] };
    const child = createEntity('Child');
    child.entity.transform = { ...createTransform(), position: [1, 0, 0] };
    child.entity.parent = parent.entity.id;
    parent.entity.children = [child.entity.id];

    // Rotated a quarter turn about Y, so the child's local +X points at -Z,
    // and doubled, so one unit out becomes two.
    close(worldPosition(sceneWith([parent, child]), child.entity.id), [5, 0, -2]);
  });
});

describe('moving between parents', () => {
  it('gives the transform that leaves the object exactly where it was', () => {
    const parent = createEntity('Parent');
    parent.entity.transform = { position: [5, 0, 0], rotation: [0, Math.PI / 2, 0], scale: [2, 2, 2] };
    const loose = createEntity('Loose');
    loose.entity.transform = { ...createTransform(), position: [1, 2, 3] };
    const scene = sceneWith([parent, loose]);

    const local = localTransformUnder(scene, loose.entity.id, parent.entity.id);

    // Applying it under the parent has to reproduce the world position it had
    // as a root. This is the whole contract.
    const moved = {
      ...loose,
      entity: { ...loose.entity, parent: parent.entity.id, transform: local },
    };
    parent.entity.children = [moved.entity.id];
    close(worldPosition(sceneWith([parent, moved]), moved.entity.id), [1, 2, 3]);
  });

  it('works in the other direction, out to the root', () => {
    const parent = createEntity('Parent');
    parent.entity.transform = { position: [-3, 1, 4], rotation: [0.3, 0.4, 0.5], scale: [1.5, 1.5, 1.5] };
    const child = createEntity('Child');
    child.entity.transform = { ...createTransform(), position: [2, 0, 1] };
    child.entity.parent = parent.entity.id;
    parent.entity.children = [child.entity.id];
    const scene = sceneWith([parent, child]);
    const before = worldPosition(scene, child.entity.id);

    const local = localTransformUnder(scene, child.entity.id, null);
    const freed = { ...child, entity: { ...child.entity, parent: null, transform: local } };

    close(worldPosition(sceneWith([parent, freed]), freed.entity.id), before);
  });

  it('leaves a transform alone when neither parent moves anything', () => {
    const parent = createEntity('Parent');
    const child = createEntity('Child');
    child.entity.transform = { ...createTransform(), position: [1, 2, 3], scale: [2, 2, 2] };
    const scene = sceneWith([parent, child]);

    // An identity parent must not perturb the numbers: a reparent onto one is
    // the common case, and rewriting it would churn the document for nothing.
    const local = localTransformUnder(scene, child.entity.id, parent.entity.id);
    close(local.position, [1, 2, 3]);
    close(local.scale, [2, 2, 2]);
  });
});
