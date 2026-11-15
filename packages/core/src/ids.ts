const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/*
 * An id is text, and its type says whose it is: an entity's, a component's, an
 * asset's or a scene's. A function that takes a `SceneId` refuses an `AssetId`,
 * where plain `string` parameters took any of them and found out at run time,
 * or never.
 *
 * The kind exists in the type alone, so it costs nothing at run time and cannot
 * be read back from the value: an entity's id and an asset's are both twelve
 * letters. It comes from where the value is read. A factory knows what it makes,
 * and code that takes a value from outside — a file, a message, three's
 * `userData`, the user's script — knows which field it is reading, and checks it
 * there. The check verifies the form, which is all a value can show: text that
 * is not empty. An empty slot is `null`, never `''`.
 *
 * This file is the only place an id is made or checked. A cast would claim the
 * kind with no check, and a second check written elsewhere would soon disagree
 * with this one about the form; the ratchet test refuses a type predicate over
 * an id type anywhere else.
 */
declare const idKind: unique symbol;

export type Id<Kind extends string> = string & { readonly [idKind]: Kind };

export type EntityId = Id<'entity'>;
export type ComponentId = Id<'component'>;
export type AssetId = Id<'asset'>;
export type SceneId = Id<'scene'>;
/**
 * An importer's: the format it reads, stable across versions, which the layers
 * that cannot live in `core` key their half of the format by. The built-ins name
 * themselves with `fixedId('importer', …)`; nothing reads one from outside yet.
 */
export type ImporterId = Id<'importer'>;

/**
 * Short, collision-resistant text. Uses `crypto.getRandomValues`, available in
 * both the renderer and Node 24.
 *
 * Plain text, for the ids nothing branded needs: a device, a request, a
 * collision layer. An entity, a component, an asset or a scene takes its id
 * from its own factory.
 */
export function createId(size = 12): string {
  let out = '';
  for (const byte of crypto.getRandomValues(new Uint8Array(size))) {
    out += ALPHABET.charAt(byte % ALPHABET.length);
  }
  return out;
}

/** The form of an id of any kind: text that is not empty. */
function isIdOf<Kind extends string>(value: unknown): value is Id<Kind> {
  return typeof value === 'string' && value !== '';
}

/**
 * A new id, narrowed by the check rather than claimed. Twelve letters and
 * digits always pass, so the throw cannot be reached: it is what keeps the
 * result honest if `createId` ever made something else.
 */
function made<Kind extends string>(): Id<Kind> {
  const text = createId();
  if (!isIdOf<Kind>(text)) throw new Error(`createId made "${text}", which is not an id`);
  return text;
}

export function createEntityId(): EntityId {
  return made<'entity'>();
}

export function createComponentId(): ComponentId {
  return made<'component'>();
}

export function createAssetId(): AssetId {
  return made<'asset'>();
}

export function createSceneId(): SceneId {
  return made<'scene'>();
}

/*
 * The checks, for a value taken from outside: a file, a message, a URL, a
 * `userData`, the user's script. The kind is the caller's to know.
 */

export function isEntityId(value: unknown): value is EntityId {
  return isIdOf<'entity'>(value);
}

export function isComponentId(value: unknown): value is ComponentId {
  return isIdOf<'component'>(value);
}

export function isAssetId(value: unknown): value is AssetId {
  return isIdOf<'asset'>(value);
}

export function isSceneId(value: unknown): value is SceneId {
  return isIdOf<'scene'>(value);
}

/**
 * A component type's id read from outside: the key of a table in a file. The
 * types this build defines are named by their literals and need no check; this
 * is what lets a key be asked of the registry, and kept when the registry does
 * not know it.
 */
export function isComponentTypeId(value: unknown): value is Id<'componentType'> {
  return isIdOf<'componentType'>(value);
}

/**
 * An id written as a constant: `fixedId('entity', 'cube')`.
 *
 * It takes a literal and nothing else. The parameter is `never` for a `string`,
 * so a text computed at run time cannot go through here, and `fixedId` cannot
 * become the cast it replaces: such a text comes from a factory, or through a
 * check. Throws on `''`, which is no id.
 */
export function fixedId<Kind extends string, Text extends string>(
  kind: Kind,
  text: Text & (string extends Text ? never : unknown),
): Id<Kind> {
  if (!isIdOf<Kind>(text)) throw new Error(`A fixed ${kind} id cannot be empty`);
  return text;
}

/**
 * A JSON record keyed by ids, as a Map: each key goes through the check of the
 * kind it holds, and a key that fails it is dropped.
 *
 * A record is a JSON shape — a file, a message, a component's data — and its
 * keys are text again the moment `Object.keys` reads them. In memory a
 * collection whose keys are read back as ids is a Map, so that the key keeps
 * its type, and this is the one way a record becomes one.
 */
export function idMapOf<I extends string, V>(
  record: Readonly<Record<string, V>>,
  isId: (key: string) => key is I,
): Map<I, V> {
  const map = new Map<I, V>();
  for (const [key, value] of Object.entries(record)) {
    if (isId(key)) map.set(key, value);
  }
  return map;
}
