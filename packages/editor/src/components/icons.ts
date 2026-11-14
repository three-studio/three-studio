import { Boxes, Camera, Lightbulb, Volume2, Waves } from 'lucide-react';
import type { HierarchyIcon } from './registry';

/**
 * The kernel's Hierarchy icons, by rank.
 *
 * One list for the kernel's types rather than a file in each type's folder,
 * because what it says is the ranking: read together, the lines are the order
 * a row's icon is decided in. A type that is not here does not decide — a
 * mesh, a model, a collider, a script — and draws the plain box.
 */
export const HIERARCHY_ICONS: readonly HierarchyIcon[] = [
  { id: 'prefabInstance', icon: Boxes, priority: 1 },
  { id: 'light', icon: Lightbulb, priority: 2 },
  { id: 'camera', icon: Camera, priority: 3 },
  // After the three above and before the fall-through: an entity that is a
  // sound and nothing else is very common — a dropped clip makes one — and a
  // row of identical boxes is a hierarchy nobody can scan.
  { id: 'audioSource', icon: Volume2, priority: 4 },
  { id: 'audioListener', icon: Volume2, priority: 5 },
  // Last of the kernel's and still ahead of the fall-through: a water surface
  // would otherwise draw the same box as a mesh, and the one thing a hierarchy
  // row has to say is what the entity is.
  { id: 'water', icon: Waves, priority: 6 },
];
