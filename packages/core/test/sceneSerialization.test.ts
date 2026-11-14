import {
  COMPONENT_TYPES,
  assertDefined,
  createComponent,
  createEmptyScene,
  createEntity,
  createPrefabInstance,
  deserializeScene,
  insertEntity,
  jsonOf,
  putComponent,
  serializeScene,
  stableJson,
  type SceneDoc,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';

/*
 * A scene file has to be the same file on two machines, or a project cannot
 * live in git — see `stableJson`.
 *
 * The order a JSON object's keys come out in is the order they went in, which
 * for a document an editor built is the order the author worked in. That is the
 * thing being taken out of the file here, and the thing that must **not** be
 * taken out of the arrays, where order is the meaning.
 */

/**
 * The same document, assembled twice in opposite orders.
 *
 * Everything carrying an identity is made once and shared, so the only
 * difference between the two is the order things were put in — which is exactly
 * the difference that used to reach the file.
 */
function bothWays(): [SceneDoc, SceneDoc] {
  const alpha = createEntity('Alpha').entity;
  const beta = createEntity('Beta').entity;
  const meshOnAlpha = createComponent('mesh');
  const meshOnBeta = createComponent('mesh');
  // Two of one type on one entity: the only object key order in this format
  // that anything ever read back.
  const hullOne = createComponent('collider');
  const hullTwo = createComponent('collider');

  const rootOrder = [alpha.id, beta.id];

  const first: SceneDoc = { ...createEmptyScene(), id: 'scene', rootOrder };
  first.entities.set(alpha.id, alpha);
  first.entities.set(beta.id, beta);
  putComponent(first, alpha.id, meshOnAlpha);
  putComponent(first, beta.id, meshOnBeta);
  putComponent(first, alpha.id, hullOne);
  putComponent(first, alpha.id, hullTwo);

  const second: SceneDoc = { ...createEmptyScene(), id: 'scene', rootOrder };
  second.entities.set(beta.id, beta);
  second.entities.set(alpha.id, alpha);
  putComponent(second, alpha.id, hullTwo);
  putComponent(second, alpha.id, hullOne);
  putComponent(second, beta.id, meshOnBeta);
  putComponent(second, alpha.id, meshOnAlpha);

  return [first, second];
}

describe('a scene serialises to one file however it was built', () => {
  it('writes the same string for two documents built in opposite orders', () => {
    const [first, second] = bothWays();

    // Not vacuous: this is the pair of files the two authors used to commit.
    expect(jsonOf(second, 2)).not.toBe(jsonOf(first, 2));

    expect(serializeScene(second)).toBe(serializeScene(first));
  });

  it('writes the same string again for a document that has been through a file', () => {
    const [scene] = bothWays();
    const once = serializeScene(scene);

    // The reorganisation happens once, and once only. Reading rebuilds objects
    // as it fills defaults — `fillMissingFields` reassigns every transform and
    // every component, and sets `id` last — so this is what says the sort
    // survives the trip rather than being undone by the migration.
    expect(serializeScene(deserializeScene(once))).toBe(once);
  });

  it('leaves arrays alone, because in this format their order is the meaning', () => {
    const parent = createEntity('Parent').entity;
    const kidA = createEntity('Kid A').entity;
    const kidB = createEntity('Kid B').entity;
    const lone = createEntity('Lone').entity;

    // Descending, so these are provably not the order a sort would put them in
    // whatever ids the factory happened to mint.
    parent.children = [kidA.id, kidB.id].sort().reverse();
    for (const kid of [kidA, kidB]) kid.parent = parent.id;
    parent.transform.position = [3, 1, 2];
    const rootOrder = [parent.id, lone.id].sort().reverse();

    const scene: SceneDoc = { ...createEmptyScene(), rootOrder };
    for (const entity of [parent, kidA, kidB, lone]) scene.entities.set(entity.id, entity);

    const written = JSON.parse(serializeScene(scene));

    // The hierarchy, twice over, and then a Vec3 — three numbers whose
    // positions are what say which is x.
    expect(written.rootOrder).toEqual(rootOrder);
    expect(written.entities[parent.id].children).toEqual(parent.children);
    expect(written.entities[parent.id].transform.position).toEqual([3, 1, 2]);
  });
});

/*
 * A document holds its containers in Maps, and a Map is `{}` to
 * `JSON.stringify`: written as it stands, an entity table would reach the file,
 * the bridge and a device as nothing at all, and nothing in the types says so.
 * So the two writers know Maps, each for its own reader. A file is for a person
 * and a diff, and sorts keys. A message is only parsed, and keeps the order it
 * was built in, which is what makes it cheap.
 */
describe('a Map in a document', () => {
  const nested = () => ({
    b: new Map([
      ['y', { n: 1 }],
      ['x', { n: 2 }],
    ]),
    a: [new Map([['k', 3]])],
  });

  it('is written to a file as the object it stands for, its keys sorted', () => {
    expect(stableJson(nested())).toBe(stableJson({ a: [{ k: 3 }], b: { x: { n: 2 }, y: { n: 1 } } }));
    expect(stableJson(new Map([['a', 1]]))).toBe('{\n  "a": 1\n}');
  });

  it('is written to a message as the object it stands for, in its own order', () => {
    expect(jsonOf(nested())).toBe('{"b":{"y":{"n":1},"x":{"n":2}},"a":[{"k":3}]}');
  });

  it('is a Map inside a Map, written as objects all the way down', () => {
    expect(jsonOf(new Map([['outer', new Map([['inner', 1]])]]))).toBe('{"outer":{"inner":1}}');
  });

  it('leaves everything else as JSON.stringify writes it, an indent included', () => {
    const plain = { b: [1, { c: null, d: undefined }], a: 'x', e: new Date(0) };

    expect(jsonOf(plain)).toBe(JSON.stringify(plain));
    expect(jsonOf(plain, 2)).toBe(JSON.stringify(plain, null, 2));
  });
});

/*
 * The file's shape is an object keyed by entity id, and the document's is a
 * Map, so that an edit does not copy and freeze ten thousand keys one by one.
 * The same goes for the component tables, a Map of Maps in memory and an object
 * of objects in the file. The conversion happens once, where a file is read,
 * and goes back where it is written: what is read and written again has to be
 * the same bytes, and what this build does not know has to come through as it
 * was.
 */
describe('a scene through a file', () => {
  const SPARKLE = { id: 'sparkle-1', type: 'plugin.sparkle', amount: 3, nested: { kept: [1, 2] } };

  /**
   * A scene with nested entities, a component of every type this build knows,
   * a prefab instance, and the table of a type no module of this build defines,
   * written as a file.
   */
  function written(): { json: string; unknownOn: string } {
    const parent = createEntity('Parent', [createComponent('mesh'), createComponent('collider')]);
    const child = createEntity('Child', [createComponent('rigidbody')]);
    const crate = createEntity('Crate', [createPrefabInstance('prefab-1')]);
    const everything = createEntity(
      'Everything',
      COMPONENT_TYPES.map((type) => createComponent(type)),
    );
    const scene: SceneDoc = { ...createEmptyScene(), id: 'scene' };
    insertEntity(scene, parent);
    insertEntity(scene, child, parent.entity.id);
    insertEntity(scene, crate);
    insertEntity(scene, everything);
    const file = JSON.parse(serializeScene(scene));
    file.components['plugin.sparkle'] = { [crate.entity.id]: { [SPARKLE.id]: SPARKLE } };
    return { json: stableJson(file), unknownOn: crate.entity.id };
  }

  it('is written back byte for byte', () => {
    const { json } = written();

    expect(serializeScene(deserializeScene(json))).toBe(json);
  });

  it('holds its entities in a Map, every one of them', () => {
    const { json } = written();

    const scene = deserializeScene(json);

    expect(scene.entities).toBeInstanceOf(Map);
    expect(scene.entities.size).toBe(Object.keys(JSON.parse(json).entities).length);
    expect(scene.entities.size).toBe(4);
    const parent = assertDefined([...scene.entities.values()].find((entity) => entity.name === 'Parent'), 'Parent');
    expect(scene.entities.get(parent.id)).toBe(parent);
  });

  it('holds the table of every known type as a Map of Maps, each component under its own id', () => {
    const scene = deserializeScene(written().json);

    // The fixture carries every type, so no table is empty by accident.
    expect(COMPONENT_TYPES.filter((type) => scene.components[type].size === 0)).toEqual([]);
    for (const type of COMPONENT_TYPES) {
      expect(scene.components[type], type).toBeInstanceOf(Map);
      for (const held of scene.components[type].values()) {
        expect(held, type).toBeInstanceOf(Map);
        for (const [id, component] of held) expect(component.id, type).toBe(id);
      }
    }
  });

  it('reads a type the file has no table for as an empty Map', () => {
    const file = JSON.parse(serializeScene(createEmptyScene()));
    file.components = {};

    const scene = deserializeScene(JSON.stringify(file));

    for (const type of COMPONENT_TYPES) {
      expect(scene.components[type], type).toBeInstanceOf(Map);
      expect(scene.components[type].size, type).toBe(0);
    }
  });

  it('keeps the table of an unknown type exactly as found', () => {
    const { json, unknownOn } = written();

    const out = JSON.parse(serializeScene(deserializeScene(json)));

    expect(out.components['plugin.sparkle']).toEqual({ [unknownOn]: { [SPARKLE.id]: SPARKLE } });
  });

  it('keeps it as the object it came in, which is no Map, because nothing here can read into it', () => {
    const { json, unknownOn } = written();

    const kept = Reflect.get(deserializeScene(json).components, 'plugin.sparkle');

    expect(kept).not.toBeInstanceOf(Map);
    expect(kept).toEqual({ [unknownOn]: { [SPARKLE.id]: SPARKLE } });
  });

  it('is not reshaped by a table a file names like a prototype', () => {
    const file = JSON.parse(serializeScene(createEmptyScene()));
    // JSON.parse makes it an own key, which is what a hostile file would write.
    file.components = JSON.parse('{"__proto__": {"mesh": {"x": {"y": {}}}}}');

    const scene = deserializeScene(JSON.stringify(file));

    expect(Object.getPrototypeOf(scene.components)).toBe(Object.prototype);
    expect(scene.components.mesh.size).toBe(0);
  });
});
