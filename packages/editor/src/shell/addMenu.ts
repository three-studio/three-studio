import {
  GEOMETRY_LABELS,
  createAudioListenerEntity,
  createAudioSourceEntity,
  createCameraEntity,
  createEntity,
  createLightEntity,
  createMeshEntity,
  type EntityTemplate,
  type GeometryKind,
  type LightKind,
} from '@three-studio/core';
import { addEntityInView } from '../commands/placeEntity';
import { modKey } from '../platform';
import { groupCommand } from '../commands/registry';
import type { MenuEntry } from '../ui/Menu';

/*
 * What "Add" can create, shared by the menu bar and the hierarchy context menu
 * so the two can never drift apart.
 *
 * Grouped into submenus rather than one flat list: the primitives alone make a
 * list long enough to run off the bottom of a short window, and the three.js
 * editor, Unity and Blender all group them this way.
 */

/** Ordered the way an author reaches for them, not the way the union declares them. */
const MESH_KINDS: readonly (GeometryKind | null)[] = [
  'box',
  'sphere',
  'plane',
  'capsule',
  'cylinder',
  null,
  'circle',
  'ring',
  'torus',
  'torusKnot',
  null,
  'tetrahedron',
  'octahedron',
  'dodecahedron',
  'icosahedron',
];

/**
 * Shorter than the entity names: the submenu title already says "Light".
 *
 * Ordered by how often one is reached for, not alphabetically — and the two
 * scene-wide kinds sit last because they are the ones that ignore where they
 * are put.
 */
const LIGHT_LABELS: Record<LightKind, string> = {
  directional: 'Directional',
  point: 'Point',
  spot: 'Spot',
  rectArea: 'Area',
  projector: 'Projector',
  ambient: 'Ambient',
  hemisphere: 'Hemisphere',
};

const LIGHT_KINDS = Object.keys(LIGHT_LABELS) as readonly LightKind[];

/*
 * Where the new object lands is `addEntityInView`'s business, not the menu's.
 * There used to be a `parentId` parameter here, threaded through every entry and
 * passed by nobody: the one caller took the default. The selection is read at
 * the moment the entry is picked instead, which is also the moment it is true.
 */
export function buildAddMenu(): MenuEntry[] {
  const add = (factory: () => EntityTemplate) => () => addEntityInView(factory());

  return [
    // three calls this a Group; Unity calls it an Empty. Both names are in the
    // label because someone who wants a group looks for the word "group", and
    // one that only said "Empty" reads as "there is no group in this editor".
    { label: 'Empty (Group)', onSelect: add(() => createEntity('Empty')) },
    {
      // The other half, and the one that is actually asked for: an empty is
      // trivial to make, and dragging five objects into it one at a time is not.
      //
      // Through the registry since phase 12. This entry asked
      // `selection.length === 0` while Cmd+G asked `can('group')`, so a locked
      // object was refused by the shortcut and grouped by the menu.
      label: groupCommand.label(),
      shortcut: `${modKey}G`,
      disabled: !groupCommand.can(),
      onSelect: () => groupCommand.run(),
    },
    null,
    {
      label: 'Mesh',
      submenu: MESH_KINDS.map((kind) =>
        kind === null
          ? null
          : { label: GEOMETRY_LABELS[kind], onSelect: add(() => createMeshEntity(kind)) },
      ),
    },
    {
      label: 'Light',
      submenu: LIGHT_KINDS.map((kind) => ({
        label: LIGHT_LABELS[kind],
        onSelect: add(() => createLightEntity(kind)),
      })),
    },
    {
      label: 'Camera',
      submenu: [
        { label: 'Perspective', onSelect: add(() => createCameraEntity('perspective')) },
        { label: 'Orthographic', onSelect: add(() => createCameraEntity('orthographic')) },
      ],
    },
    {
      label: 'Audio',
      submenu: [
        { label: 'Audio Source', onSelect: add(() => createAudioSourceEntity()) },
        // Rarely reached for, and worth having: without one the ear rides the
        // camera, which is right until the camera is not where the player is.
        { label: 'Audio Listener', onSelect: add(() => createAudioListenerEntity()) },
      ],
    },
  ];
}
