/*
 * Every component type that draws, imported so that its system registers.
 *
 * The five that have an object of their own. The other seven have none —
 * physics, audio, scripts and controllers are built by their own layers from
 * the same document, and a prefab instance was turned into real entities by
 * `expandPrefabs` before the runtime ever saw the scene.
 *
 * A hard-coded table of five lived in `Reconciler.ts`, which meant that adding
 * a type that draws was editing the file that knows about none of them. What
 * replaces it is the seam `registerBehaviour` already was: registration is a
 * side effect of the import, and this file is the single place that has to be
 * complete.
 */
import type { ComponentType } from '@three-studio/core';
import { systemRegistered } from '../systems/ComponentSystem';

import './mesh';
import './model';
import './light';
import './camera';
import './water';
import './particleEmitter';

/*
 * Checked here, once, rather than trusted.
 *
 * A missing import above does not fail — it makes the type *quietly* unbuilt,
 * and the entity simply shows nothing in the viewport, which reads as a broken
 * asset rather than as a missing line. `core/src/components/index.ts` throws on
 * the same omission for the same reason.
 *
 * The list is the imports written a second time, which core does not have to do
 * — `COMPONENT_TYPES` exists there for its own reasons. Here it is the only
 * independent statement of what ought to be present, and it earns its keep the
 * day someone adds a folder and forgets the line above: `componentCoverage.test.ts`
 * cannot see that, because it reads the files on disk and not the imports.
 */
const DRAWN_TYPES = [
  'mesh',
  'model',
  'light',
  'camera',
  'water',
  'particleEmitter',
] as const satisfies readonly ComponentType[];

const unregistered = DRAWN_TYPES.filter((type) => !systemRegistered(type));
if (unregistered.length > 0) {
  throw new Error(`Component types that draw but registered no system: ${unregistered.join(', ')}.`);
}

export { buildSystems } from '../systems/ComponentSystem';
export type { AnySystem } from '../systems/ComponentSystem';
