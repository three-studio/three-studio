import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { commandById, commandIds, currentContext } from '../commands/registry';
import { useEditorStore } from '../state/editorStore';
import { useOverlay } from '../state/overlayStore';
import { shortcutHint } from './shortcutBindings';

/**
 * Every gesture that can act right now, filtered by what has been typed.
 *
 * **This is a view over data, not a feature.** Milestone 8.4 says the palette
 * "falls out of the registry", and it does: the labels are `label(ctx)`, the
 * greying is `can(ctx)`, the keys down the right are the binding table's, and
 * the list is `commandIds()`. There is nothing here about *which* gestures exist
 * — adding one to any family puts it in this list with no change to this file,
 * which is the point of the whole batch.
 *
 * Rendered into `document.body` for the reason `DialogFrame` is: `position:
 * fixed` is relative to the viewport only while no ancestor carries a transform,
 * and dockview gives its panels one.
 */
export function CommandPalette() {
  const open = useEditorStore((s) => s.paletteOpen);
  const close = useEditorStore((s) => s.closePalette);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Mounted always, showing nothing until asked — so the overlay is declared
  // conditionally through `active`, which is what that argument is for.
  useOverlay('modal', close, open);

  /**
   * The context is read once per opening, not per keystroke.
   *
   * Nothing can change the selection while a modal covers the editor, so asking
   * again on every letter would be the same answer at the cost of rebuilding
   * every label. `open` in the dependency list is what makes it an "on opening".
   */
  const entries = useMemo(() => {
    if (!open) return [];
    const ctx = currentContext();
    return commandIds()
      .map((id) => ({ id, command: commandById(id) }))
      // `can()` decides, exactly as it does for a menu entry. A palette showing
      // twenty greyed rows is a worse palette, and the gestures that need a
      // target — an asset, a scene — answer `false` here on their own, because
      // the context names none.
      .filter(({ command }) => command.can(ctx))
      .map(({ id, command }) => ({
        id,
        label: command.label(ctx),
        hint: shortcutHint(id),
        run: () => command.run(ctx),
      }));
  }, [open]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return entries;
    return entries.filter((entry) => entry.label.toLowerCase().includes(needle));
  }, [entries, query]);

  // A fresh palette every time, and a selection that cannot point past the end
  // of a list the last keystroke shortened.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);
  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const choose = (index: number) => {
    const entry = matches[index];
    if (!entry) return;
    // Closed first, so a gesture that opens a dialog of its own stacks above the
    // editor rather than under a palette that is on its way out.
    close();
    entry.run();
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-dialog flex justify-center bg-black/50 pt-[12vh]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="flex h-fit max-h-[60vh] w-full max-w-[560px] flex-col overflow-hidden rounded-sm border border-line-soft bg-surface-1 shadow-2xl shadow-black/60">
        <input
          ref={(element) => element?.focus({ preventScroll: true })}
          value={query}
          placeholder="Type a command…"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // Escape is deliberately not handled: it belongs to whatever is on
            // top of the overlay stack, and this is it. Taking it here would put
            // back the bug where two open surfaces both closed.
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((current) => Math.min(current + 1, matches.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((current) => Math.max(current - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              choose(active);
            }
          }}
          className="shrink-0 border-b border-line bg-surface-2 px-3 py-2 text-xs text-ink outline-none placeholder:text-ink-dim"
        />

        <div ref={listRef} className="min-h-0 overflow-y-auto py-1">
          {matches.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              // `onPointerDown` rather than `onClick`: the input has focus, and
              // a click would blur it first, which closes nothing but does move
              // focus out from under the keyboard handling above.
              onPointerDown={(event) => {
                event.preventDefault();
                choose(index);
              }}
              onPointerEnter={() => setActive(index)}
              className={`flex w-full items-center gap-3 px-3 py-1.5 text-left text-2xs ${
                index === active ? 'bg-accent-dim text-ink' : 'text-ink-muted'
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              {entry.hint && <span className="shrink-0 text-ink-dim">{entry.hint}</span>}
            </button>
          ))}

          {matches.length === 0 && (
            <p className="px-3 py-2 text-2xs text-ink-dim">
              {entries.length === 0 ? 'Nothing can act right now.' : 'No command matches.'}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
