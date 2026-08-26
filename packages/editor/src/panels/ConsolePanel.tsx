import { Ban, CircleAlert, Info, Search, TriangleAlert, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useConsoleStore, type LogLevel } from '../state/consoleStore';
import { PanelToolbar } from './PanelShell';

const LEVEL_STYLE: Record<LogLevel, { icon: typeof Info; className: string; label: string }> = {
  log: { icon: Info, className: 'text-ink-muted', label: 'Messages' },
  warn: { icon: TriangleAlert, className: 'text-warn', label: 'Warnings' },
  error: { icon: CircleAlert, className: 'text-error', label: 'Errors' },
};

export function ConsolePanel() {
  const entries = useConsoleStore((s) => s.entries);
  const levels = useConsoleStore((s) => s.levels);
  const clear = useConsoleStore((s) => s.clear);
  const toggleLevel = useConsoleStore((s) => s.toggleLevel);

  const [query, setQuery] = useState('');
  const [pinned, setPinned] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter(
      (entry) => levels[entry.level] && (needle === '' || entry.text.toLowerCase().includes(needle)),
    );
  }, [entries, levels, query]);

  useEffect(() => {
    // Following the tail is only useful while the reader is already at the
    // bottom; yanking them back while they scroll through an error is not.
    //
    // Scrolling this element directly, never `scrollIntoView`: that scrolls
    // *every* scrollable ancestor, and it dragged the whole editor shell up
    // until the menu bar sat above the window with no way to bring it back.
    if (!pinned) return;
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [visible.length, pinned]);

  const counts = useMemo(() => {
    const totals: Record<LogLevel, number> = { log: 0, warn: 0, error: 0 };
    for (const entry of entries) totals[entry.level] += entry.count;
    return totals;
  }, [entries]);

  return (
    <div className="flex h-full w-full flex-col bg-surface-1">
      <PanelToolbar>
        <button
          type="button"
          onClick={clear}
          title="Clear"
          className="flex h-5 shrink-0 items-center gap-1 rounded-sm px-1.5 text-2xs text-ink-muted hover:bg-surface-3 hover:text-ink"
        >
          <Ban size={11} />
          Clear
        </button>

        <div className="mx-1 flex min-w-20 flex-1 items-center gap-1 rounded-sm bg-surface-1 px-1.5">
          <Search size={11} className="shrink-0 text-ink-dim" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter"
            className="min-w-0 flex-1 bg-transparent py-0.5 text-2xs text-ink outline-none placeholder:text-ink-dim"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} className="text-ink-dim hover:text-ink">
              <X size={11} />
            </button>
          )}
        </div>

        {(Object.keys(LEVEL_STYLE) as LogLevel[]).map((level) => {
          const style = LEVEL_STYLE[level];
          const Icon = style.icon;
          return (
            <button
              key={level}
              type="button"
              title={style.label}
              onClick={() => toggleLevel(level)}
              className={`flex h-5 shrink-0 items-center gap-1 rounded-sm px-1.5 text-2xs ${
                levels[level] ? `bg-surface-3 ${style.className}` : 'text-ink-dim'
              }`}
            >
              <Icon size={11} />
              {counts[level]}
            </button>
          );
        })}
      </PanelToolbar>

      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-auto font-mono text-2xs"
        onScroll={(event) => {
          const el = event.currentTarget;
          setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
        }}
      >
        {visible.length === 0 ? (
          <p className="p-3 text-ink-dim">
            {entries.length === 0 ? 'Nothing logged yet.' : 'No message matches.'}
          </p>
        ) : (
          visible.map((entry) => {
            const style = LEVEL_STYLE[entry.level];
            const Icon = style.icon;
            return (
              <div
                key={entry.id}
                className="flex items-start gap-2 border-b border-line/60 px-2 py-1 hover:bg-surface-2"
                data-selectable
              >
                <Icon size={11} className={`mt-0.5 shrink-0 ${style.className}`} />
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-ink">
                  {entry.text}
                </span>
                {entry.count > 1 && (
                  <span className="shrink-0 rounded-sm bg-surface-3 px-1 text-ink-muted">
                    ×{entry.count}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
