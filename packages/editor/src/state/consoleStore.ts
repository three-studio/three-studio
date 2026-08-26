import { create } from 'zustand';

export type LogLevel = 'log' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  level: LogLevel;
  text: string;
  at: number;
  /** Consecutive identical messages are folded into one row. */
  count: number;
}

/** Bounded so a script logging every frame cannot exhaust memory. */
const MAX_ENTRIES = 500;

interface ConsoleState {
  entries: LogEntry[];
  levels: Record<LogLevel, boolean>;
  append: (level: LogLevel, text: string) => void;
  clear: () => void;
  toggleLevel: (level: LogLevel) => void;
}

let nextId = 1;

export const useConsoleStore = create<ConsoleState>()((set) => ({
  entries: [],
  levels: { log: true, warn: true, error: true },

  append: (level, text) =>
    set((state) => {
      const last = state.entries.at(-1);
      // Collapsing repeats is what keeps a per-frame log readable, and is what
      // both Unity and the browser console do.
      if (last && last.level === level && last.text === text) {
        const folded = { ...last, count: last.count + 1, at: Date.now() };
        return { entries: [...state.entries.slice(0, -1), folded] };
      }

      const entries = [...state.entries, { id: nextId++, level, text, at: Date.now(), count: 1 }];
      return { entries: entries.length > MAX_ENTRIES ? entries.slice(-MAX_ENTRIES) : entries };
    }),

  clear: () => set({ entries: [] }),
  toggleLevel: (level) =>
    set((state) => ({ levels: { ...state.levels, [level]: !state.levels[level] } })),
}));

function format(args: readonly unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

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

  const append = (level: LogLevel) => {
    const original = console[level].bind(console);
    return (...args: unknown[]) => {
      original(...args);
      useConsoleStore.getState().append(level, format(args));
    };
  };

  console.log = append('log');
  console.warn = append('warn');
  console.error = append('error');

  window.addEventListener('error', (event) => {
    useConsoleStore.getState().append('error', event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    useConsoleStore.getState().append('error', `Unhandled rejection: ${String(event.reason)}`);
  });
}
