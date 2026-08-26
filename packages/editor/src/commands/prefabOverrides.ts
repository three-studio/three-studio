import {
  componentsOf,
  prefabInstanceOf,
  splitInstancedId,
  type ComponentDoc,
  type PrefabOverride,
  type SceneDoc,
} from '@three-studio/core';
import { expandedScene } from '../state/expansion';

/**
 * Records an edit to an instance's contents as an override on the instance.
 *
 * Called from the ordinary scene commands rather than from each caller, so the
 * gizmo, the Inspector and the hierarchy all get this for free — and none of
 * them has to know whether what it is editing came from a prefab.
 *
 * Silently does nothing for an id the document holds itself; the callers use it
 * as a fallback when their own lookup misses.
 */
export function editInstance(
  scene: SceneDoc,
  id: string,
  apply: (override: PrefabOverride, current: readonly ComponentDoc[]) => void,
): void {
  const parts = splitInstancedId(id);
  if (!parts) return;

  // Any depth. `parts.local` is the whole path inside the outermost instance —
  // `inner/lampRoot` for a lamp the room placed — and the expansion looks the
  // override up by exactly that. There is no component in the scene for the
  // room's own placement of the lamp, so the scene's instance is where it goes.
  if (scene.entities[parts.owner] === undefined) return;
  const component = prefabInstanceOf(scene, parts.owner);
  if (!component) return;

  // The entity as it is drawn, overrides already applied — which is what the
  // caller needs to build the next one from.
  const expanded = expandedScene().scene;
  if (expanded.entities[id] === undefined) return;

  const override: PrefabOverride = component.overrides[parts.local] ?? {};
  apply(override, componentsOf(expanded, id));
  component.overrides[parts.local] = override;
}

/**
 * Writes one property of a component, at any depth, into an override.
 *
 * `applyOverride` merges at the top level of a component, so a change to
 * `material.color` has to store the whole material. That is the shape it reads,
 * and storing the leaf alone would quietly drop every sibling property.
 */
export function overrideComponentPath(
  override: PrefabOverride,
  current: readonly ComponentDoc[],
  componentId: string,
  path: readonly string[],
  value: unknown,
): void {
  const found = current.find((candidate) => candidate.id === componentId);
  const component = found as unknown as Record<string, unknown> | undefined;
  const head = path[0];
  const last = path.at(-1);
  if (!component || head === undefined || last === undefined) return;

  let stored: unknown = value;
  if (path.length > 1) {
    const root = structuredClone(component[head]);
    let target = root as Record<string, unknown>;
    for (const key of path.slice(1, -1)) {
      const next = target[key];
      if (typeof next !== 'object' || next === null) return;
      target = next as Record<string, unknown>;
    }
    target[last] = value;
    stored = root;
  }

  const components = override.components ?? {};
  components[componentId] = { ...components[componentId], [head]: stored };
  override.components = components;
}
