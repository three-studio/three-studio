import type { Patch } from 'immer';

/*
 * The undo stack, and what one user action is.
 *
 * Lifted out of `documentStore`. What is here is everything that can be decided
 * without touching the store: what an entry holds, when two edits are one
 * gesture, and how a drag of six hundred patches becomes one. Applying an entry
 * is the store's, because that is where the scene and the selection live.
 */

const HISTORY_LIMIT = 200;

/**
 * Work that belongs to an undo step but does not live in the document.
 *
 * Material assets are the reason: they are files, shared by many entities, so
 * editing one changes nothing in the scene — but it is still an edit the user
 * made and expects Cmd+Z to take back. Rather than a second history stack that
 * would interleave wrongly with the first, such an edit rides in the same
 * entry and is replayed by calling back out.
 */
export interface ExternalEdit {
  apply: () => void;
  revert: () => void;
}

/**
 * One user action, whole.
 *
 * `selectionBefore` and `selectionAfter` are not optional, and that is the point:
 * an optional field is a field somebody forgets, which is exactly how undo used
 * to leave the gizmo pointing at an entity it had just deleted: the selection
 * was set after the edit, so no entry described it and undo could not take it
 * back.
 */
export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
  selectionBefore: readonly string[];
  selectionAfter: readonly string[];
  /** Non-null while the entry may absorb further edits from the same gesture. */
  coalesceKey: string | null;
  external?: ExternalEdit | undefined;
}

/**
 * The undo stack and where the file stands, as one value.
 *
 * Taken and put back together by Prefab Mode: opening a prefab sets the scene's
 * history aside instead of destroying it. It used to clear the stack, so one
 * unlucky double-click on a prefab threw away every scene undo. They travel as
 * one because `savedRevision` means nothing without the `revision` it is compared
 * to — restoring one and not the other is how a document ends up permanently
 * dirty, or permanently clean.
 */
export interface HistoryStash {
  past: HistoryEntry[];
  future: HistoryEntry[];
  revision: number;
  savedRevision: number;
}

/**
 * Collapses repeated writes to the same path down to one.
 *
 * A ten-second drag at 60fps leaves ~600 patch/inverse pairs in a single
 * coalesced entry, none of which will ever be reduced. Each frame overwrites
 * the same `transform.position`, so all but one of them are dead weight — kept
 * in memory, walked by `affectedEntities`, and copied on every subsequent
 * mutation of the gesture.
 *
 * The surviving patch keeps the **position of the first** and the **value of the
 * last**, which is correct for both directions: applied in order, the last
 * writer to a path wins, and an inverse array is stored oldest-last, so its last
 * occurrence is the oldest value — the one an undo must land on.
 *
 * Only when every patch is a `replace`. An `add` or a `remove` on an array moves
 * the indices its neighbours refer to, so reordering around one changes what the
 * patches mean. A drag produces nothing but `replace`, which is the case this is
 * for; anything else is left exactly as it came.
 */
function compact(patches: Patch[]): Patch[] {
  if (patches.length < 2) return patches;
  if (!patches.every((patch) => patch.op === 'replace')) return patches;

  const out: Patch[] = [];
  const seen = new Map<string, number>();
  for (const patch of patches) {
    const key = patch.path.join('\u0000');
    const at = seen.get(key);
    if (at === undefined) {
      seen.set(key, out.length);
      out.push(patch);
    } else {
      out[at] = patch;
    }
  }
  return out;
}

/** An edit as `mutate` hands it over, before the stack has decided anything. */
export interface NewEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
  selectionBefore: readonly string[];
  selectionAfter: readonly string[];
  coalesceKey: string | null;
  external?: ExternalEdit | undefined;
}

/**
 * The stack after one edit.
 *
 * Coalescing is decided here rather than by the caller because it is a question
 * about the stack: does the last entry still belong to the gesture this edit is
 * part of. A drag or a slider scrub shares a key across hundreds of mutations
 * and has to come back as one Cmd+Z.
 */
export function pushEdit(past: readonly HistoryEntry[], edit: NewEntry): HistoryEntry[] {
  const previous = past.at(-1);
  const canCoalesce =
    edit.coalesceKey !== null &&
    previous !== undefined &&
    previous.coalesceKey === edit.coalesceKey;

  const entry: HistoryEntry = canCoalesce
    ? {
        label: previous.label,
        patches: compact([...previous.patches, ...edit.patches]),
        // Inverse patches undo in reverse order, so the older ones go last.
        inverse: compact([...edit.inverse, ...previous.inverse]),
        // The gesture began where the first mutation of it began: one undo has
        // to reach the start of the drag, not its second frame.
        selectionBefore: previous.selectionBefore,
        selectionAfter: edit.selectionAfter,
        coalesceKey: edit.coalesceKey,
        external: previous.external,
      }
    : { ...edit, patches: [...edit.patches], inverse: [...edit.inverse] };

  const grown = canCoalesce ? [...past.slice(0, -1), entry] : [...past, entry];
  return grown.length > HISTORY_LIMIT ? grown.slice(grown.length - HISTORY_LIMIT) : grown;
}
