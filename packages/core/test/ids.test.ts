import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  createAssetId,
  createComponentId,
  createEntityId,
  createId,
  createSceneId,
  fixedId,
  idMapOf,
  isAssetId,
  isComponentId,
  isEntityId,
  isSceneId,
  type AssetId,
  type ComponentId,
  type EntityId,
  type SceneId,
} from '@three-studio/core';

interface Kind {
  readonly name: string;
  readonly create: () => string;
  readonly is: (value: unknown) => boolean;
}

const KINDS: readonly Kind[] = [
  { name: 'entity', create: createEntityId, is: isEntityId },
  { name: 'component', create: createComponentId, is: isComponentId },
  { name: 'asset', create: createAssetId, is: isAssetId },
  { name: 'scene', create: createSceneId, is: isSceneId },
];

for (const { name, create, is } of KINDS) {
  describe(`a ${name} id`, () => {
    it('is twelve letters and digits, and passes its own check', () => {
      const id = create();

      expect(id).toMatch(/^[A-Za-z0-9]{12}$/);
      expect(is(id)).toBe(true);
    });

    it('is not made twice in ten thousand', () => {
      expect(new Set(Array.from({ length: 10_000 }, () => create())).size).toBe(10_000);
    });

    it('is refused when it is empty, or not text at all', () => {
      expect(is('')).toBe(false);
      expect(is(7)).toBe(false);
      expect(is(null)).toBe(false);
      expect(is(undefined)).toBe(false);
      expect(is({ id: 'a' })).toBe(false);
    });
  });
}

describe('createId', () => {
  it('stays text of the size it is asked for, for the ids that are not branded', () => {
    expect(createId()).toHaveLength(12);
    expect(createId(16)).toMatch(/^[A-Za-z0-9]{16}$/);
  });
});

describe('fixedId', () => {
  it('returns its text as an id of the kind', () => {
    const cube: EntityId = fixedId('entity', 'cube');

    expect(cube).toBe('cube');
    expect(isEntityId(cube)).toBe(true);
  });

  it('refuses an empty text, which is no id', () => {
    expect(() => fixedId('entity', '')).toThrow('A fixed entity id cannot be empty');
  });
});

describe('idMapOf', () => {
  it('keeps the keys that are ids, in the order of the record, and drops the others', () => {
    const map = idMapOf({ first: 1, '': 2, second: 3 }, isAssetId);

    expect([...map]).toEqual([
      ['first', 1],
      ['second', 3],
    ]);
  });
});

/*
 * What the compiler is held to. These read at `npm run typecheck`: an
 * expectation that no longer holds is a type error, and the code that relies on
 * each one is written on that. They pin TypeScript 7's behaviour, which a
 * later release could change under us.
 */
describe('the types', () => {
  it('keep a kind of id from standing for another, or for plain text', () => {
    expectTypeOf<EntityId>().toExtend<string>();
    expectTypeOf<string>().not.toExtend<EntityId>();
    expectTypeOf<AssetId>().not.toExtend<EntityId>();
    expectTypeOf<EntityId>().not.toExtend<ComponentId>();
    expectTypeOf<SceneId>().not.toExtend<AssetId>();
  });

  it('keep a Map keyed by text from standing for a Map keyed by ids', () => {
    expectTypeOf<Map<string, number>>().not.toExtend<Map<EntityId, number>>();
    expectTypeOf<Map<EntityId, number>>().not.toExtend<Map<AssetId, number>>();
  });

  it('give a record keyed by ids the id as its key', () => {
    expectTypeOf<keyof Record<EntityId, number>>().toEqualTypeOf<EntityId>();
  });

  it('refuse a text that is not a literal to fixedId, which would otherwise be the cast it replaces', () => {
    expectTypeOf(fixedId<'entity', string>).parameter(1).toBeNever();
    expectTypeOf(fixedId('entity', 'cube')).toEqualTypeOf<EntityId>();
  });

  it('give idMapOf the kind of its check', () => {
    const record: Readonly<Record<string, number>> = { first: 1 };

    expectTypeOf(idMapOf(record, isAssetId)).toEqualTypeOf<Map<AssetId, number>>();
  });
});
