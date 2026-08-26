import { hasComponent } from './components';
import { prefabInstanceOf, splitInstancedId } from './prefab';
import type { SceneDoc } from './schema';

/*
 * What an entity can be asked to do, in its current state.
 *
 * One derivation, read by everything that offers an action: the gizmo, the
 * picker, the hierarchy's context menu, the keyboard shortcuts. Before it, each
 * of those asked its own question in its own way and answered it differently —
 * and `entity.locked` was read by nobody at all, which is B11: the padlock did
 * nothing.
 *
 * This is Blender's `poll()` and Unreal's `CanEditChange`, as a function on
 * plain data rather than a method: `EntityDoc` is JSON, and it has to stay JSON
 * for the play-mode snapshot, the save and the web export to work.
 *
 * **Not a permission system.** These say what makes sense, not what is allowed.
 * Every command keeps its own refusals — see `graph.ts` — so a capability
 * computed wrongly can annoy someone, but it can never corrupt a document.
 */
export type EntityCapability =
  | 'translate'
  | 'rotate'
  | 'scale'
  | 'rename'
  | 'delete'
  | 'duplicate'
  | 'reparent'
  | 'toggleVisible'
  | 'toggleLock'
  | 'group'
  | 'makePrefab'
  | 'unpackPrefab'
  /** Turn an imported model into one entity per node of its file. */
  | 'unpackModel';

const ALL: readonly EntityCapability[] = [
  'translate',
  'rotate',
  'scale',
  'rename',
  'delete',
  'duplicate',
  'reparent',
  'toggleVisible',
  'toggleLock',
  'group',
  'makePrefab',
  'unpackPrefab',
  'unpackModel',
];

/** Refused to a locked entity: everything that moves it or makes it go away. */
const LOCKED_DENIES: readonly EntityCapability[] = [
  'translate',
  'rotate',
  'scale',
  'delete',
  'reparent',
  'group',
  'unpackModel',
];

/**
 * Refused to an entity a prefab produced.
 *
 * It is not the scene's to restructure: the next expansion rebuilds it from the
 * asset, so a delete comes straight back and a reparent is forgotten. Moving it
 * is fine and deliberately still allowed — that becomes an override, which is
 * the whole point of instances differing from each other.
 */
const PRODUCED_DENIES: readonly EntityCapability[] = [
  'delete',
  'duplicate',
  'reparent',
  'group',
  'makePrefab',
  'toggleLock',
  // Unpacking writes a dozen entities where the prefab produces one. The next
  // expansion rebuilds the instance from the asset and they are simply gone.
  'unpackModel',
];

/**
 * @param scene The scene the entity is read from — the **expanded** one, for
 *   any caller that can be pointed at an instance's contents.
 * @param id The id the entity is known by *here*. An expanded `owner/local` id
 *   says the entity came out of a prefab, which the entity itself cannot tell
 *   you — expansion produces an ordinary `EntityDoc`.
 */
export function capabilitiesOf(scene: SceneDoc, id: string): ReadonlySet<EntityCapability> {
  const entity = scene.entities[id];
  // An id naming nothing can do nothing. Every caller used to ask this
  // separately, and one that forgot would have read `locked` off `undefined`.
  if (!entity) return new Set();

  const allowed = new Set<EntityCapability>(ALL);

  if (entity.locked) for (const capability of LOCKED_DENIES) allowed.delete(capability);
  if (splitInstancedId(id) !== null) for (const capability of PRODUCED_DENIES) allowed.delete(capability);

  // Unpacking is what an instance is for; making a prefab out of one would nest
  // it inside itself.
  if (prefabInstanceOf(scene, id) === undefined) allowed.delete('unpackPrefab');
  else allowed.delete('makePrefab');

  // There is nothing to take apart without a file to take apart.
  if (!hasComponent(scene, id, 'model')) allowed.delete('unpackModel');

  return allowed;
}
