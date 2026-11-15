import { Group, Object3D } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { ENTITY_ID_KEY, resolveEntityId } from '../src/systems/identity';

/*
 * An object says which entity it belongs to through three's `userData`, which
 * holds whatever anything put there: the systems write it, and so can a model
 * file's extras or a script. What it holds is read as the id it has to be.
 */

/** An object that carries `value` as the entity it belongs to, whatever that is. */
function carrying(value: unknown): Object3D {
  const object = new Group();
  object.userData[ENTITY_ID_KEY] = value;
  return object;
}

describe('the entity an object belongs to', () => {
  it('is the id the object carries', () => {
    expect(resolveEntityId(carrying('cube'))).toBe('cube');
  });

  it('is the id of the nearest object above it that carries one', () => {
    const owner = carrying('owner');
    const middle = new Group();
    const leaf = new Group();
    owner.add(middle);
    middle.add(leaf);

    expect(resolveEntityId(leaf)).toBe('owner');
  });

  it('is nothing for a value that is not an id', () => {
    expect(resolveEntityId(carrying(''))).toBeUndefined();
    expect(resolveEntityId(carrying(7))).toBeUndefined();
    expect(resolveEntityId(carrying(null))).toBeUndefined();
    expect(resolveEntityId(new Group())).toBeUndefined();
    expect(resolveEntityId(null)).toBeUndefined();
  });

  it('goes on to the object above when what it carries is not an id', () => {
    const owner = carrying('owner');
    const child = carrying('');
    owner.add(child);

    // An empty id names no entity, and the walk asks the next object up for one.
    expect(resolveEntityId(child)).toBe('owner');
  });
});
