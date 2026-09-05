/*
 * The pane every component type offers the inspector, assembled.
 *
 * A total `Record<ComponentType, …>`, which is the property this whole lot is
 * about: `COMPONENT_SCHEMAS` was the one list of the nine the compiler
 * protected, and it was protected because it was total. Adding a member to
 * `ComponentDoc` is an error here, in `overlays.ts` and in `menus.ts`, and in
 * none of them is it a silently empty panel.
 *
 * Three files rather than one, and the reason is a cycle rather than a taste.
 * A pane reaches the commands and the stores — extracting a material opens a
 * dialog, a prefab row runs half of `prefabCommands` — while the overlay is
 * read from inside the viewport. `state/projectStore` still imports the
 * viewport (the layer violation lot 4 closes), so one module importing both
 * halves puts `markerStyles` inside that knot. Splitting by the side of the
 * editor that asks keeps each import going one way.
 */
import type { ComponentDoc, ComponentType } from '@three-studio/core';
import {
  isGeometrySlot,
  type ComponentSchema,
  type GeometrySlotSpec,
  type PaneEntry,
} from '../inspector/fields';
import { inspector as audioListener } from './audioListener/inspector';
import { inspector as audioSource } from './audioSource/inspector';
import { inspector as camera } from './camera/inspector';
import { inspector as collider } from './collider/inspector';
import { inspector as light } from './light/inspector';
import { inspector as mesh } from './mesh/inspector';
import { inspector as model } from './model/inspector';
import { inspector as playerController } from './playerController/inspector';
import { inspector as prefabInstance } from './prefabInstance/inspector';
import { inspector as rigidbody } from './rigidbody/inspector';
import { inspector as script } from './script/inspector';
import { inspector as water } from './water/inspector';

export const COMPONENT_PANES: Record<ComponentType, ComponentSchema> = {
  mesh,
  model,
  water,
  light,
  camera,
  rigidbody,
  collider,
  audioSource,
  audioListener,
  script,
  prefabInstance,
  playerController,
};

/**
 * The rows a component's pane would offer, and the identity of that list.
 *
 * Two entries are not fixed by the component's type — see the facets on
 * `ComponentSchema`. That is what `key` is for; everything else about the shape
 * is `visibleWhen`, and `shapeOf` reads it.
 */
export function paneEntriesFor(component: ComponentDoc): {
  key: string;
  entries: readonly Exclude<PaneEntry, GeometrySlotSpec>[];
} {
  const pane = COMPONENT_PANES[component.type];
  // The geometry slot expands in place, so a type that never declares one — all
  // but `mesh` — is unaffected.
  const entries: Exclude<PaneEntry, GeometrySlotSpec>[] = pane.fields.flatMap((entry) =>
    isGeometrySlot(entry) ? [...(pane.geometryFields?.(component) ?? [])] : [entry],
  );
  entries.push(...(pane.extraFields?.(component) ?? []));

  return { key: pane.paneKey?.(component) ?? component.type, entries };
}
