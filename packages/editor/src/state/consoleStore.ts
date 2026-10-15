import { formatLogArgs } from '@three-studio/core';
import { create } from 'zustand';

export type LogLevel = 'log' | 'warn' | 'error';

/**
 * Where a line was logged, when not in this window: a device on the network,
 * by its id and the label its row shows.
 *
 * A line from a phone has to say so, and in a way its page cannot imitate. A
 * page can print `[iPhone]` at the start of its text; it cannot set a source,
 * which only the device server's lines carry.
 */
export interface LogSource {
  id: string;
  label: string;
}

export interface LogEntry {
  id: number;
  level: LogLevel;
  text: string;
  at: number;
  /** Consecutive identical messages are folded into one row. */
  count: number;
  /** `null` for this window: the editor, its Play, its scripts. */
  source: LogSource | null;
}

/** A line as it arrives, possibly folded already. */
export interface LogLine {
  level: LogLevel;
  text: string;
  count: number;
}

/** Bounded so a script logging every frame cannot exhaust memory. */
const MAX_ENTRIES = 500;

interface ConsoleState {
  entries: LogEntry[];
  levels: Record<LogLevel, boolean>;
  append: (level: LogLevel, text: string, source?: LogSource | null) => void;
  /**
   * A batch of lines from one source, in one change. Line by line, a batch
   * of a hundred would copy the whole list a hundred times, and draw the
   * panel as often.
   */
  appendMany: (source: LogSource | null, lines: readonly LogLine[]) => void;
  clear: () => void;
  toggleLevel: (level: LogLevel) => void;
}

let nextId = 1;

/**
 * `entries` with `lines` after them, each folded into the line before it
 * when it repeats it — collapsing repeats is what keeps a per-frame log
 * readable, and is what both Unity and the browser console do. Only within
 * one source: the same words from the editor and from a phone, or from two
 * phones, are different facts.
 */
function appended(
  entries: readonly LogEntry[],
  source: LogSource | null,
  lines: readonly LogLine[],
): LogEntry[] {
  const next = [...entries];
  const at = Date.now();
  for (const { level, text, count } of lines) {
    const last = next.at(-1);
    if (
      last &&
      last.level === level &&
      last.text === text &&
      (last.source?.id ?? null) === (source?.id ?? null)
    ) {
      next[next.length - 1] = { ...last, count: last.count + count, at };
    } else {
      next.push({ id: nextId++, level, text, at, count, source });
    }
  }
  return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
}

export const useConsoleStore = create<ConsoleState>()((set) => ({
  entries: [],
  levels: { log: true, warn: true, error: true },

  append: (level, text, source = null) =>
    set((state) => ({ entries: appended(state.entries, source, [{ level, text, count: 1 }]) })),

  appendMany: (source, lines) => {
    if (lines.length === 0) return;
    set((state) => ({ entries: appended(state.entries, source, lines) }));
  },

  clear: () => set({ entries: [] }),
  toggleLevel: (level) =>
    set((state) => ({ levels: { ...state.levels, [level]: !state.levels[level] } })),
}));

let installed = false;

/**
 * Mirrors the page console into the editor's Console panel.
 *
 * Scripts run in the renderer, so their output already goes to devtools — but
 * an author working in the editor should not have to open devtools to see why
 * their script did nothing. The original console is still called, so devtools
 * keeps working as usual.
 */
export function captureConsole(): void {
  if (installed) return;
  installed = true;

  const hook = (method: 'log' | 'info' | 'warn' | 'error', level: LogLevel) => {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);
      useConsoleStore.getState().append(level, formatLogArgs(args));
    };
  };

  hook('log', 'log');
  // A message like any other: the Console has three levels, and a script's
  // `console.info` reaches it from a phone, so it must from Play too.
  // `debug` stays out, for the probes that log every event to devtools alone.
  hook('info', 'log');
  hook('warn', 'warn');
  hook('error', 'error');

  window.addEventListener('error', (event) => {
    useConsoleStore.getState().append('error', event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    useConsoleStore
      .getState()
      .append('error', `Unhandled rejection: ${formatLogArgs([event.reason])}`);
  });
}
