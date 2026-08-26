import {
  createEmptyScene,
  createPrefabDoc,
  emptyComponentTables,
  setComponentsOf,
  type EntityTemplate,
  type PrefabDoc,
  type SceneDoc,
} from '@three-studio/core';
import { expect } from 'vitest';

/*
 * Helpers shared by the tests of every package.
 *
 * Three files had their own copy of `sceneWith` and the copies had already
 * drifted: one of them put every entity in `rootOrder`, which is only true of a
 * flat scene. A fixture that disagrees with itself is worse than no fixture,
 * because the test that reads the wrong copy still passes.
 */

/**
 * A throwaway scene holding exactly these entities.
 *
 * Parents are read from the entities themselves, so callers set `parent` and
 * `children` and the roots follow. Everything the caller does not care about —
 * the environment block above all — comes from the factory rather than a
 * literal, which is what keeps these tests out of the way of a new field.
 */
export function sceneWith(templates: readonly EntityTemplate[]): SceneDoc {
  const entities = templates.map((template) => template.entity);
  const scene: SceneDoc = {
    ...createEmptyScene(),
    // Fixed rather than generated: a test that prints a scene should print the
    // same thing twice.
    id: 'scene',
    entities: Object.fromEntries(entities.map((entity) => [entity.id, entity])),
    rootOrder: entities.filter((entity) => entity.parent === null).map((entity) => entity.id),
  };
  // The components go with them: they are stored beside the entity table now,
  // and a fixture that dropped them would test a scene of empty entities.
  for (const template of templates) {
    setComponentsOf(scene, template.entity.id, template.components);
  }
  return scene;
}

/**
 * A prefab holding exactly these entities, components included.
 *
 * `createPrefabDoc` takes the component tables ready-made, because in
 * production they are lifted from a scene that already has them. A test builds
 * its entities from the factories, so it needs the same assembly `sceneWith`
 * does.
 */
export function prefabWith(
  name: string,
  templates: readonly EntityTemplate[],
  root: string,
): PrefabDoc {
  const components = emptyComponentTables();
  const host = { components };
  for (const template of templates) {
    setComponentsOf(host, template.entity.id, template.components);
  }
  return createPrefabDoc(
    name,
    templates.map((template) => template.entity),
    components,
    root,
  );
}

/** Vector comparison that tolerates the last bits: matrix maths never lands exactly. */
export const close = (actual: readonly number[], expected: readonly number[]): void => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 5));
};
