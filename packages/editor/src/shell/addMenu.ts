import {
  GEOMETRY_LABELS,
  createEntity,
  createMeshEntity,
  createWaterEntity,
  type EntityTemplate,
  type GeometryKind,
} from '@three-studio/core';
import { menu as audioListenerMenu } from '../components/audioListener/menu';
import { menu as audioSourceMenu } from '../components/audioSource/menu';
import { menu as cameraMenu } from '../components/camera/menu';
import { menu as lightMenu } from '../components/light/menu';
import type { AddMenuEntry } from '../components/registry';
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

/** One thing a slice offers, as a menu entry that places it. */
const offer = (entry: AddMenuEntry): MenuEntry =>
  entry === null ? null : { label: entry.label, onSelect: () => addEntityInView(entry.create()) };

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
    { label: lightMenu.label, submenu: lightMenu.entries.map(offer) },
    { label: cameraMenu.label, submenu: cameraMenu.entries.map(offer) },
    {
      label: audioSourceMenu.label,
      submenu: [...audioSourceMenu.entries, ...audioListenerMenu.entries].map(offer),
    },
    {
      // A submenu for one entry, on purpose: this is where the things that are
      // the *scene* rather than an object in it will go — fog and volumes are
      // the obvious next two — and moving Water in later would move it out from
      // under whatever muscle memory it had built by then.
      label: 'Environment',
      submenu: [{ label: 'Water', onSelect: add(() => createWaterEntity()) }],
    },
  ];
}
