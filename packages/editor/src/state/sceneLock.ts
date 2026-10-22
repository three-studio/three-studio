import { useEditorStore, type PlayState } from './editorStore';
import { toastSlot } from './toastStore';

/*
 * From the press of Play until Stop, nothing edits the scene document.
 *
 * Every surface used to edit it while the game ran, and Stop put back the copy
 * taken at the press, keeping the history. An edit made during Play vanished
 * at Stop while its undo entry stayed — so the next Cmd+Z applied patches made
 * against a document Stop had replaced: an entity removed that the restored
 * scene never had, an order rewritten by index. Cmd+S during Play wrote those
 * edits to disk and marked the scene saved, then Stop took them out of memory,
 * leaving on screen what was not on disk, with nothing to say so. An edit that
 * cannot last is now refused where it is made, and said.
 *
 * The rule, its words and the one toast live here, so that the document's
 * guard, the commands, the menus and the panels ask one place and cannot
 * disagree about when the scene is locked or what a refusal says.
 */

/** From the press of Play until Stop — Pause included — the scene is locked. */
export function sceneLocked(playState: PlayState): boolean {
  return playState !== 'stopped';
}

/** The same, read now: for the document's guard, a command's `can()`, a gesture. */
export function isSceneLocked(): boolean {
  return sceneLocked(useEditorStore.getState().playState);
}

/**
 * The same for React. A boolean selector, so a panel re-renders when the lock
 * moves and not at every change of the editor's store — a selection included.
 */
export function useSceneLocked(): boolean {
  return useEditorStore((state) => sceneLocked(state.playState));
}

/** What a greyed control says: a menu row's detail, a tooltip's hint, a panel's strip. */
export const STOP_TO_EDIT = 'Stop to edit';

/**
 * One toast for every refusal, replaced where it stands: Delete held down
 * during Play would otherwise stack copies that say nothing more than one, and
 * push everything else off the five the stack holds.
 */
const refusal = toastSlot();
/** Set from the first refusal of a Play until its Stop. */
let watchingForStop: (() => void) | null = null;

/**
 * Says a refused gesture: one warning, never stacked, with the way out on it.
 *
 * A warning does not time out, and this one stays true until Stop — so it goes
 * at Stop, by itself. The first refusal of a Play subscribes to the editor's
 * store and the Stop it hears dismisses the toast and unsubscribes: nothing to
 * install, and nothing listening while nobody has been refused.
 *
 * The store's `stop`, not the `stop` command: the commands ask this module
 * whether they may run, and this one importing the registry back would close
 * a cycle.
 */
export function refuseWhileLocked(): void {
  refusal.show({
    kind: 'warning',
    title: 'Stop the game to edit the scene',
    actions: [{ label: 'Stop', primary: true, onClick: () => useEditorStore.getState().stop() }],
  });
  if (watchingForStop !== null) return;
  watchingForStop = useEditorStore.subscribe((state) => {
    if (sceneLocked(state.playState)) return;
    refusal.dismiss();
    watchingForStop?.();
    watchingForStop = null;
  });
}
