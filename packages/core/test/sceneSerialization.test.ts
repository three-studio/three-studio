import {
  createComponent,
  createEmptyScene,
  createEntity,
  deserializeScene,
  putComponent,
  serializeScene,
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
  first.entities[alpha.id] = alpha;
  first.entities[beta.id] = beta;
  putComponent(first, alpha.id, meshOnAlpha);
  putComponent(first, beta.id, meshOnBeta);
  putComponent(first, alpha.id, hullOne);
  putComponent(first, alpha.id, hullTwo);

  const second: SceneDoc = { ...createEmptyScene(), id: 'scene', rootOrder };
  second.entities[beta.id] = beta;
  second.entities[alpha.id] = alpha;
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
    expect(JSON.stringify(second, null, 2)).not.toBe(JSON.stringify(first, null, 2));

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
    for (const entity of [parent, kidA, kidB, lone]) scene.entities[entity.id] = entity;

    const written = JSON.parse(serializeScene(scene)) as SceneDoc;

    // The hierarchy, twice over, and then a Vec3 — three numbers whose
    // positions are what say which is x.
    expect(written.rootOrder).toEqual(rootOrder);
    expect(written.entities[parent.id]!.children).toEqual(parent.children);
    expect(written.entities[parent.id]!.transform.position).toEqual([3, 1, 2]);
  });
});
