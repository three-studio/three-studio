import {
  capabilitiesOf,
  createEntity,
  createMeshEntity,
  createPrefabInstance,
  instancedId,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { sceneWith } from './fixtures';

/*
 * What an entity can be asked to do. One derivation, so that greying a menu
 * entry, refusing a drop and ignoring a key are the same line of code — before
 * this, six questions were re-asked in eight files with eight answers, and
 * `entity.locked` was read by nobody at all.
 */

describe('an ordinary entity', () => {
  it('can do everything except be unpacked', () => {
    const cube = createMeshEntity('box');
    const can = capabilitiesOf(sceneWith([cube]), cube.entity.id);

    expect(can.has('translate')).toBe(true);
    expect(can.has('delete')).toBe(true);
    expect(can.has('makePrefab')).toBe(true);
    // Nothing to unpack: it is not an instance of anything.
    expect(can.has('unpackPrefab')).toBe(false);
  });
});

describe('a locked entity', () => {
  it('cannot be moved, deleted or reparented', () => {
    const entity = createMeshEntity('box');
    entity.entity.locked = true;
    const can = capabilitiesOf(sceneWith([entity]), entity.entity.id);

    // B11. The field existed from the first version and nothing read it, so the
    // padlock in the hierarchy did precisely nothing.
    for (const denied of ['translate', 'rotate', 'scale', 'delete', 'reparent', 'group'] as const) {
      expect(can.has(denied), denied).toBe(false);
    }
  });

  it('can still be renamed, hidden, and unlocked again', () => {
    const entity = createMeshEntity('box');
    entity.entity.locked = true;
    const can = capabilitiesOf(sceneWith([entity]), entity.entity.id);

    // A lock that could not be undone from the entity it locks would be a trap.
    expect(can.has('toggleLock')).toBe(true);
    expect(can.has('rename')).toBe(true);
    expect(can.has('toggleVisible')).toBe(true);
    expect(can.has('duplicate')).toBe(true);
  });
});

describe('an entity a prefab produced', () => {
  const producedId = instancedId('host', 'trunk');

  /**
   * The entity as the *expanded* scene holds it — under its produced id, which
   * is where every caller reads it from. `capabilitiesOf` takes the scene now,
   * so the id has to name something in it.
   */
  const expandedWith = (template = createMeshEntity('box')) => {
    template.entity.id = producedId;
    return sceneWith([template]);
  };

  it('cannot be deleted, duplicated or reparented', () => {
    const can = capabilitiesOf(expandedWith(), producedId);

    // The next expansion rebuilds it from the asset: a delete comes straight
    // back, and a reparent is forgotten.
    for (const denied of ['delete', 'duplicate', 'reparent', 'makePrefab'] as const) {
      expect(can.has(denied), denied).toBe(false);
    }
  });

  it('can still be moved, because that becomes an override', () => {
    const can = capabilitiesOf(expandedWith(), producedId);

    // Deliberate, and the whole reason instances can differ from one another.
    expect(can.has('translate')).toBe(true);
    expect(can.has('rotate')).toBe(true);
    expect(can.has('scale')).toBe(true);
    expect(can.has('rename')).toBe(true);
  });

  it('is refused by both rules at once when it is also locked', () => {
    const entity = createMeshEntity('box');
    entity.entity.locked = true;
    const can = capabilitiesOf(expandedWith(entity), producedId);

    expect(can.has('translate')).toBe(false);
    expect(can.has('delete')).toBe(false);
  });
});

describe('an entity placing a prefab', () => {
  it('can be unpacked, but not made into a prefab', () => {
    const host = createEntity('Tree', [createPrefabInstance('prefab-1')]);
    const can = capabilitiesOf(sceneWith([host]), host.entity.id);

    expect(can.has('unpackPrefab')).toBe(true);
    // It already is one; making a prefab of it would nest it inside itself.
    expect(can.has('makePrefab')).toBe(false);
    expect(can.has('delete')).toBe(true);
  });
});
