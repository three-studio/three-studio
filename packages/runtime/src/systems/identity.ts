import type { Object3D } from 'three/webgpu';

/**
 * Set on every object a system creates, and on every child of a loaded model,
 * so picking can map a hit back to the document.
 *
 * In a module of its own because both ends need it and neither may import the
 * other: the systems write it, and `SceneBinder` — which imports the systems —
 * re-exports it for the editor's picker.
 *
 * An object that reaches the scene without it is silently unclickable, which is
 * the kind of failure that looks like a broken gizmo rather than a missing line.
 */
export const ENTITY_ID_KEY = 'studioEntityId';

/**
 * Walks up from a hit object to the entity that owns it.
 *
 * A raycast lands on a mesh, a model's child, or a batch's member; only the
 * chain above it says which entity that is.
 */
export function resolveEntityId(object: Object3D | null): string | undefined {
  let current: Object3D | null = object;
  while (current) {
    const id: unknown = current.userData[ENTITY_ID_KEY];
    if (typeof id === 'string') return id;
    current = current.parent;
  }
  return undefined;
}
