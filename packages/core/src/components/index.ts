/*
 * Every component type, imported so that it registers.
 *
 * Registration is a side effect of the import, and a module nobody imports
 * registers nothing — the type then goes missing with no error at all. This file
 * is the single place that has to be complete, and `registry.test.ts` counts what
 * arrives against `COMPONENT_TYPES`.
 */
import { COMPONENT_TYPES } from '../scene/components';
import { createCollider } from '../scene/defaults';
import type { ComponentDoc, ComponentOfType, ComponentType, MeshComponent } from '../scene/schema';
import { componentDefinition } from './registry';

import './mesh';
import './model';
import './light';
import './camera';
import './rigidbody';
import './collider';
import './audioSource';
import './audioListener';
import './script';
import './prefabInstance';
import './playerController';

/*
 * Checked here, once, rather than trusted.
 *
 * A missing import above does not fail — it makes the type *quietly* absent, and
 * the failure surfaces far away: `fillComponent` hands a stored component back
 * unfilled, and the `undefined` reaches three several layers later. That exact
 * shape of bug has shipped twice on this project, both times as a field the
 * migration did not fill.
 *
 * Throwing at import turns it into the first thing anyone sees, in production as
 * well as in the test that counts the same list.
 */
const unregistered = COMPONENT_TYPES.filter((type) => componentDefinition(type) === undefined);
if (unregistered.length > 0) {
  throw new Error(`Component types declared but never registered: ${unregistered.join(', ')}.`);
}

export {
  componentAssets,
  componentDefinition,
  componentDefinitions,
  defineComponent,
  fillComponent,
  typesWithoutRuntime,
  type ComponentDefinition,
  type ComponentIcon,
} from './registry';

/**
 * Blank instance of a component type, used by "Add Component" in the inspector.
 *
 * Lives here rather than in `defaults.ts` for two reasons. The modules above
 * import their factories from `defaults.ts`, so a lookup there would close a
 * cycle — three of those have already been paid for on this refactor. And the
 * table is only complete once those eleven imports have run: being in the same
 * module as them is what makes "the type is registered" true by construction
 * rather than by hope.
 *
 * Throws on a type it does not know rather than falling back. The chain this
 * replaced ended in `createPlayerController()`, so a component from a plugin or
 * a hand-edited file came back as a player controller with the original's fields
 * glued on — which the migration then wrote to disk.
 */
export function createComponent<T extends ComponentType>(type: T): ComponentOfType<T> {
  const definition = componentDefinition(type);
  if (!definition) throw new Error(`Unknown component type "${type}".`);
  return definition.create();
}

/**
 * Like `createComponent`, but shapes the defaults from what the entity already
 * has — a collider added to a capsule mesh comes out as a matching capsule.
 *
 * A collider whose size has nothing to do with the object it belongs to is the
 * kind of thing an author only notices once the physics behaves oddly, so the
 * guess is worth making.
 *
 * Not a facet of the registry: it reads a *sibling* component, which is a fact
 * about the entity rather than about the type. Only `collider` has ever wanted
 * it, and a `createFor(entity)` on all eleven definitions would be ten copies of
 * `create()` to serve one.
 *
 * Takes the siblings rather than the entity: an entity no longer holds them,
 * and handing over the document would put a scene-wide argument on a function
 * that reads exactly two components.
 */
export function createComponentForEntity<T extends ComponentType>(
  type: T,
  siblings: readonly ComponentDoc[],
): ComponentOfType<T> {
  if (type !== 'collider') return createComponent(type);

  const mesh = siblings.find((c): c is MeshComponent => c.type === 'mesh');
  const collider = createCollider();

  if (!mesh) {
    // A model's real shape is only known once it has loaded, so fall back to
    // the mesh it renders rather than an arbitrary box.
    const hasModel = siblings.some((c) => c.type === 'model');
    if (hasModel) collider.shape = 'trimesh';
    return collider as ComponentOfType<T>;
  }

  const geometry = mesh.geometry;
  switch (geometry.kind) {
    case 'box':
      collider.shape = 'box';
      collider.size = [geometry.width / 2, geometry.height / 2, geometry.depth / 2];
      break;
    case 'sphere':
      collider.shape = 'sphere';
      collider.radius = geometry.radius;
      break;
    case 'capsule':
      collider.shape = 'capsule';
      collider.radius = geometry.radius;
      collider.halfHeight = geometry.height / 2;
      break;
    case 'cylinder':
      collider.shape = 'capsule';
      collider.radius = Math.max(geometry.radiusTop, geometry.radiusBottom);
      collider.halfHeight = geometry.height / 2;
      break;
    case 'plane':
    case 'circle':
    case 'ring':
      // These have no volume. A thin box would be the obvious alternative, but
      // a slab thinner than the character controller's snap-to-ground distance
      // gets snapped straight through. The triangle mesh is the honest shape,
      // and its one hazard — catching on the diagonal where the two coplanar
      // triangles meet — is handled by Rapier's FIX_INTERNAL_EDGES.
      collider.shape = 'trimesh';
      break;
    case 'torus':
    case 'torusKnot':
      // Concave: a convex hull would fill the hole, which is the whole point of
      // the shape.
      collider.shape = 'trimesh';
      break;
    case 'tetrahedron':
    case 'octahedron':
    case 'dodecahedron':
    case 'icosahedron':
      // Convex by construction, and a hull is far cheaper than a triangle mesh.
      collider.shape = 'convexHull';
      break;
  }

  return collider as ComponentOfType<T>;
}
