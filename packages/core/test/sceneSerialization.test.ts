import {
  assertDefined,
  componentsOfType,
  colliderType,
  createCameraEntity,
  createComponent,
  createEmptyScene,
  createEntity,
  createEnvironment,
  createLightEntity,
  createMeshComponent,
  createMeshEntity,
  createPrefabInstance,
  rigidbodyType,
  decodeScene,
  fixedId,
  insertEntity,
  jsonOf,
  putComponent,
  serializeScene,
  stableJson,
  unwrap,
  SCENE_FORMAT_VERSION,
  type SceneDoc,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { sceneWith } from './fixtures';
import { builtInRegistries } from './registries';

const registries = builtInRegistries();
/** Every type this build knows, in the order it registered them. */
const TYPES = registries.components.values().map((definition) => definition.id);

/** A scene read from its text, by a reader that cannot go on without it. */
const read = (text: string): SceneDoc => unwrap(decodeScene(registries, text), 'Scene file');

/** A scene's file as an object, to change before it is read again. */
const fileOf = (scene: SceneDoc) => JSON.parse(serializeScene(registries, scene));

/** What a refused file says, a line per fault: its code, where it sits, and its words. */
function faults(file: unknown): string[] {
  const decoded = decodeScene(registries, typeof file === 'string' ? file : JSON.stringify(file));
  return decoded.ok ? [] : decoded.diagnostics.map(({ code, path, message }) => `${code} ${path.join('.')}: ${message}`);
}

/** Where each fault of a refused file sits, by its code and its path alone. */
const where = (file: unknown): string[] => faults(file).map((fault) => fault.slice(0, fault.indexOf(':')));

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
  const meshOnAlpha = createMeshComponent('box');
  const meshOnBeta = createMeshComponent('box');
  // Two of one type on one entity: the only object key order in this format
  // that anything ever read back.
  const hullOne = colliderType.create();
  const hullTwo = colliderType.create();

  const rootOrder = [alpha.id, beta.id];

  const first: SceneDoc = { ...createEmptyScene(), id: fixedId('scene', 'scene'), rootOrder };
  first.entities.set(alpha.id, alpha);
  first.entities.set(beta.id, beta);
  putComponent(first, alpha.id, meshOnAlpha);
  putComponent(first, beta.id, meshOnBeta);
  putComponent(first, alpha.id, hullOne);
  putComponent(first, alpha.id, hullTwo);

  const second: SceneDoc = { ...createEmptyScene(), id: fixedId('scene', 'scene'), rootOrder };
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

    expect(serializeScene(registries, second)).toBe(serializeScene(registries, first));
  });

  it('writes the same string again for a document that has been through a file', () => {
    const [scene] = bothWays();
    const once = serializeScene(registries, scene);

    // The reorganisation happens once, and once only. Reading rebuilds every
    // entity, transform and component as it decodes them, so this is what says
    // the sort survives the trip rather than being undone by the reader.
    expect(serializeScene(registries, read(once))).toBe(once);
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

    const written = JSON.parse(serializeScene(registries, scene));

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
    const parent = createEntity('Parent', [createMeshComponent('box'), colliderType.create()]);
    const child = createEntity('Child', [rigidbodyType.create()]);
    const crate = createEntity('Crate', [createPrefabInstance(fixedId('asset', 'prefab-1'))]);
    const everything = createEntity(
      'Everything',
      TYPES.map((type) => createComponent(registries, type)),
    );
    const scene: SceneDoc = { ...createEmptyScene(), id: fixedId('scene', 'scene') };
    insertEntity(scene, parent);
    insertEntity(scene, child, parent.entity.id);
    insertEntity(scene, crate);
    insertEntity(scene, everything);
    const file = JSON.parse(serializeScene(registries, scene));
    file.components['plugin.sparkle'] = { [crate.entity.id]: { [SPARKLE.id]: SPARKLE } };
    file.componentVersions['plugin.sparkle'] = 1;
    return { json: stableJson(file), unknownOn: crate.entity.id };
  }

  it('is written back byte for byte', () => {
    const { json } = written();

    expect(serializeScene(registries, read(json))).toBe(json);
  });

  it('holds its entities in a Map, every one of them', () => {
    const { json } = written();

    const scene = read(json);

    expect(scene.entities).toBeInstanceOf(Map);
    expect(scene.entities.size).toBe(Object.keys(JSON.parse(json).entities).length);
    expect(scene.entities.size).toBe(4);
    const parent = assertDefined([...scene.entities.values()].find((entity) => entity.name === 'Parent'), 'Parent');
    expect(scene.entities.get(parent.id)).toBe(parent);
  });

  it('holds the table of every known type as a Map of Maps, each component under its own id', () => {
    const scene = read(written().json);

    // The fixture carries every type, so no table is missing by accident.
    expect(TYPES.filter((type) => componentsOfType(scene, type).size === 0)).toEqual([]);
    for (const type of TYPES) {
      expect(scene.components.get(type), type).toBeInstanceOf(Map);
      for (const held of componentsOfType(scene, type).values()) {
        expect(held, type).toBeInstanceOf(Map);
        for (const [id, component] of held) {
          expect(component.id, type).toBe(id);
          expect(component.type, type).toBe(type);
        }
      }
    }
  });

  it('reads a type the file has no table for as one that holds nothing, and makes no table for it', () => {
    const file = JSON.parse(serializeScene(registries, createEmptyScene()));
    file.components = {};
    file.componentVersions = {};

    const scene = read(JSON.stringify(file));

    expect(scene.components.size).toBe(0);
    for (const type of TYPES) expect(componentsOfType(scene, type).size, type).toBe(0);
  });

  it('keeps the table of an unknown type exactly as found', () => {
    const { json, unknownOn } = written();

    const out = JSON.parse(serializeScene(registries, read(json)));

    expect(out.components['plugin.sparkle']).toEqual({ [unknownOn]: { [SPARKLE.id]: SPARKLE } });
  });

  it('keeps it apart from the known tables, read down to each component and no further', () => {
    const { json } = written();

    const scene = read(json);
    const kept = scene.unknownComponents.get(fixedId('componentType', 'plugin.sparkle'));

    // By entity and by component id, which is what lets it follow its entity;
    // the component itself is the object the file held, which nothing reads.
    expect(scene.components.has(fixedId('componentType', 'plugin.sparkle'))).toBe(false);
    expect([...(kept?.components.values() ?? [])].flatMap((held) => [...held.values()])).toEqual([SPARKLE]);
  });

  it('is not reshaped by a table a file names like a prototype', () => {
    const file = JSON.parse(serializeScene(registries, createEmptyScene()));
    // JSON.parse makes it an own key, which is what a hostile file would write.
    file.components = JSON.parse('{"__proto__": {"mesh": {"x": {"y": {}}}}}');
    file.componentVersions = JSON.parse('{"__proto__": 1}');

    const scene = read(JSON.stringify(file));

    // A table of a type nobody defines, kept under the name the file gave it:
    // a Map takes any key, and nothing is assigned to an object's prototype.
    expect(Object.getPrototypeOf(scene.components)).toBe(Map.prototype);
    expect(componentsOfType(scene, 'mesh').size).toBe(0);
    expect(scene.unknownComponents.has(fixedId('componentType', '__proto__'))).toBe(true);
    expect(Object.getPrototypeOf(JSON.parse(serializeScene(registries, scene)).components)).toBe(Object.prototype);
  });
});

/*
 * Until 1.0.0 a format that moves is a file this build refuses, with words
 * saying so, rather than one it converts: no migration code is kept. One line,
 * before anything else in the file is read, so an older scene reads as older
 * and not as broken in every field that moved since.
 */
describe('a scene of another format', () => {
  it.each([[11], [13], ['12'], [undefined]])('is refused at version %j, in one line', (version) => {
    const file = JSON.parse(serializeScene(registries, createEmptyScene()));
    file.version = version;
    // Malformed besides, which the refusal does not get as far as saying.
    file.entities = 'none';

    expect(() => read(JSON.stringify(file))).toThrow(
      new RegExp(`^Scene file\\nversion: written in .*; this build reads format ${SCENE_FORMAT_VERSION} and does not convert it$`),
    );
  });

  it('is this build\'s own at 12', () => {
    expect(SCENE_FORMAT_VERSION).toBe(12);
  });
});

/*
 * Beside its tables, a file records the version of each type it holds a
 * component of: a type's fields move with its version, and a component written
 * with other fields is refused by name rather than read as if it were this
 * build's. Once per type, not per component — a ten-thousand-entity scene
 * would write the mesh's number ten thousand times.
 */
describe('the versions a scene records of its types', () => {
  it('names each type it holds a component of, and no other, in id order', () => {
    const file = fileOf(sceneWith([createMeshEntity('box'), createLightEntity('point'), createCameraEntity()]));

    expect(file.componentVersions).toEqual({ camera: 1, light: 1, mesh: 1 });
    expect(Object.keys(file.componentVersions)).toEqual(['camera', 'light', 'mesh']);
    expect(Object.keys(file.components)).toEqual(['camera', 'light', 'mesh']);
  });

  it('writes no table and no version for a type it holds nothing of, though the document kept its table', () => {
    const scene = sceneWith([createLightEntity('point')]);
    // A table once made stays in the document, even emptied.
    scene.components.set('mesh', new Map());

    expect(fileOf(scene)).toMatchObject({ componentVersions: { light: 1 }, components: { light: expect.any(Object) } });
    expect(Object.keys(fileOf(scene).components)).toEqual(['light']);
    expect(fileOf(createEmptyScene())).toMatchObject({ componentVersions: {}, components: {} });
  });

  it('refuses a type written at another version, naming it and both versions, before reading its table', () => {
    const lamp = createLightEntity('point');
    const file = fileOf(sceneWith([lamp]));
    file.componentVersions.light = 2;
    // Not read: a component of another version is no component of this one.
    const lights = file.components.light[lamp.entity.id];
    for (const key of Object.keys(lights)) lights[key].intensity = 'bright';

    expect(faults(file)).toEqual([
      'type.version componentVersions.light: light written at version 2; this build reads version 1 and does not convert it',
    ]);
  });

  it('refuses a table it records no version for, and a version it holds no table for', () => {
    const file = fileOf(sceneWith([createLightEntity('point')]));
    delete file.componentVersions.light;
    file.componentVersions.camera = 1;

    expect(faults(file)).toEqual([
      'table.unversioned components.light: has no version in componentVersions',
      'table.unversioned componentVersions.camera: names no table in components',
    ]);
  });

  it('keeps a type no module here defines at the version its file gives, and writes both back byte for byte', () => {
    const torch = createEntity('Torch');
    const file = fileOf(sceneWith([torch, createLightEntity('point')]));
    const FLICKER = { id: 'flicker-1', type: 'plugin.flicker', rate: 3, nested: { kept: [1, 2] } };
    file.components['plugin.flicker'] = { [torch.entity.id]: { [FLICKER.id]: FLICKER } };
    file.componentVersions['plugin.flicker'] = 3;
    const json = stableJson(file);

    const scene = read(json);

    expect(scene.unknownComponents.get(fixedId('componentType', 'plugin.flicker'))?.version).toBe(3);
    expect(serializeScene(registries, scene)).toBe(json);
  });
});

/*
 * A scene is read whole: its shell, every entity, every component and its
 * environment, each field checked, and every fault named where it sits. A file
 * this build cannot read is refused rather than mended, so that what opens is
 * what the file says.
 */
describe('a scene decoded whole', () => {
  it('refuses an entity\'s malformed fields where they sit, one fault each', () => {
    const box = createMeshEntity('box');
    const file = fileOf(sceneWith([box]));
    const entity = file.entities[box.entity.id];
    entity.parent = 42;
    entity.transform.position = [0, 'up', 0];
    entity.visible = 'yes';
    delete entity.locked;
    entity.colour = 'red';
    const at = `entities.${box.entity.id}`;

    expect(where(file)).toEqual([
      `field.invalid ${at}.parent`,
      `field.invalid ${at}.transform.position`,
      `field.invalid ${at}.visible`,
      `field.missing ${at}.locked`,
      `field.unexpected ${at}.colour`,
    ]);
  });

  it('refuses an entity whose id is not its key, and a component whose id or type is not its keys', () => {
    const lamp = createLightEntity('point');
    const box = createMeshEntity('box');
    const file = fileOf(sceneWith([lamp, box]));
    file.entities[lamp.entity.id].id = 'elsewhere';
    const [lightKey] = Object.keys(file.components.light[lamp.entity.id]);
    file.components.light[lamp.entity.id][lightKey ?? ''].id = 'other';
    const [meshKey] = Object.keys(file.components.mesh[box.entity.id]);
    file.components.mesh[box.entity.id][meshKey ?? ''].type = 'light';

    expect(faults(file)).toEqual([
      `key.mismatch entities.${lamp.entity.id}.id: is "elsewhere", where its key is "${lamp.entity.id}"`,
      `key.mismatch components.light.${lamp.entity.id}.${lightKey}.id: is "other", where its key is "${lightKey}"`,
      `field.invalid components.mesh.${box.entity.id}.${meshKey}.type: expected "mesh", found "light"`,
    ]);
  });

  it.each(Object.keys(createEnvironment()))('refuses an environment whose %s is not one', (key) => {
    const file = fileOf(createEmptyScene());
    file.environment[key] = [];

    expect(where(file)).toEqual([`field.invalid environment.${key}`]);
  });

  it.each(Object.keys(createEnvironment().sky))('refuses a sky whose %s is not one', (key) => {
    const file = fileOf(createEmptyScene());
    file.environment.sky[key] = [];

    expect(where(file)).toEqual([`field.invalid environment.sky.${key}`]);
  });

  it('refuses an environment missing a field, or holding one this build does not read', () => {
    const file = fileOf(createEmptyScene());
    delete file.environment.fogDensity;
    file.environment.sky.rain = 1;

    expect(where(file).sort()).toEqual(['field.missing environment.fogDensity', 'field.unexpected environment.sky.rain']);
  });

  it('is refused in one line when it is not JSON, or not an object', () => {
    expect(faults('{ "version": 12,')).toEqual([expect.stringMatching(/^field\.invalid : is not JSON \(.+\)$/)]);
    expect(faults('[]')).toEqual(['field.invalid : expected an object, found []']);
  });
});
