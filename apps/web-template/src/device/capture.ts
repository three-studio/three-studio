import type { DeviceLogLevel } from '@three-studio/core/devices/protocol';
import { formatLogArgs } from '@three-studio/core/logFormat';

/*
 * The page's console, taken as the editor's Console will show it: what the
 * game, the runtime and the player say through `console`, what throws
 * uncaught, what nobody awaited, and what failed to load — the player's own
 * module included, a failure the player never lives to report.
 *
 * Without the page around it: `scope` is the window in the page, and a fake
 * in a test. Only the fields read here are read from an event, since the
 * tests' Node has no `ErrorEvent`.
 */

const METHODS = ['log', 'info', 'warn', 'error'] as const;

type Method = (typeof METHODS)[number];

/**
 * The Console has three levels, and `info` is a message there. `debug` is
 * left alone, as the editor's own Console leaves it.
 */
const LEVELS: Readonly<Record<Method, DeviceLogLevel>> = {
  log: 'log',
  info: 'log',
  warn: 'warn',
  error: 'error',
};

/*
 * An object rather than `true`: Node's `EventTarget`, which the tests run on,
 * reads only `options.capture` when removing.
 */
const CAPTURE = { capture: true } as const;

type Listener = (event: Event) => void;

export interface CaptureScope {
  console: Pick<Console, Method>;
  location: { href: string };
  addEventListener: (type: string, listener: Listener, options: AddEventListenerOptions) => void;
  removeEventListener: (type: string, listener: Listener, options: EventListenerOptions) => void;
}

export interface CapturedConsole {
  /**
   * The console's methods as they were. The client writes its own lines
   * through them: the editor already shows what they say, as the row's state,
   * and the phone's own inspector still sees them.
   */
  original: Readonly<Record<Method, (...args: unknown[]) => void>>;
  /** Puts the console back and stops listening. */
  stop: () => void;
}

/**
 * Hands each line the page logs to `sink`, from now on, after the console has
 * written it as it always does.
 */
export function captureLogs(
  scope: CaptureScope,
  sink: (level: DeviceLogLevel, text: string) => void,
): CapturedConsole {
  const kept: Record<Method, (...args: unknown[]) => void> = {
    log: scope.console.log,
    info: scope.console.info,
    warn: scope.console.warn,
    error: scope.console.error,
  };

  let busy = false;
  /**
   * Never in the page's way. A line logged while one is handed on is not
   * taken again — a sink that logs would otherwise never return — and a sink
   * that throws must not turn the page's `console.log` into a throw.
   */
  const take = (level: DeviceLogLevel, text: () => string): void => {
    if (busy) return;
    busy = true;
    try {
      sink(level, text());
    } catch {
      // The line is lost; the page goes on.
    } finally {
      busy = false;
    }
  };

  for (const method of METHODS) {
    const original = kept[method];
    scope.console[method] = (...args: unknown[]) => {
      original.apply(scope.console, args);
      take(LEVELS[method], () => formatLogArgs(args));
    };
  }

  // In the capture phase: an element that fails to load fires `error` on
  // itself, and it does not bubble up to the window.
  const onError: Listener = (event) => {
    const text = errorText(event, scope.location.href);
    if (text !== null) take('error', () => text);
  };
  const onRejection: Listener = (event) => {
    const { reason } = event as Event & { reason?: unknown };
    take('error', () => `Unhandled rejection: ${formatLogArgs([reason])}`);
  };
  scope.addEventListener('error', onError, CAPTURE);
  scope.addEventListener('unhandledrejection', onRejection, CAPTURE);

  const call =
    (method: Method) =>
    (...args: unknown[]): void => {
      kept[method].apply(scope.console, args);
    };
  return {
    original: { log: call('log'), info: call('info'), warn: call('warn'), error: call('error') },
    stop() {
      for (const method of METHODS) scope.console[method] = kept[method];
      scope.removeEventListener('error', onError, CAPTURE);
      scope.removeEventListener('unhandledrejection', onRejection, CAPTURE);
    },
  };
}

/**
 * An uncaught error as one line, with where it was thrown; a resource that
 * failed, by its element and its address; `null` for anything else.
 *
 * One line, as the editor writes an error: the stack stays in the phone's own
 * inspector, and it would point into the compiled bundle anyway.
 */
function errorText(event: Event, page: string): string | null {
  const { message, filename, lineno, colno } = event as Event &
    Partial<Record<'message' | 'filename' | 'lineno' | 'colno', unknown>>;
  if (typeof message === 'string') {
    if (typeof filename !== 'string' || filename === '') return message;
    let where = relativeToPage(filename, page);
    if (typeof lineno === 'number' && lineno > 0) {
      where += `:${lineno}`;
      if (typeof colno === 'number' && colno > 0) where += `:${colno}`;
    }
    return `${message} (${where})`;
  }
  const element = event.target as { tagName?: unknown; src?: unknown; href?: unknown } | null;
  if (typeof element?.tagName !== 'string') return null;
  const tag = element.tagName.toLowerCase();
  const address = [element.src, element.href].find(
    (value): value is string => typeof value === 'string' && value !== '',
  );
  return address === undefined
    ? `Failed to load ${tag}`
    : `Failed to load ${tag} ${relativeToPage(address, page)}`;
}

/**
 * An address from the page's folder on: `scripts.mjs` rather than the whole
 * address, which holds the token — and a Console line is something people
 * paste into a bug report. Any other address is kept as it is.
 */
export function relativeToPage(url: string, page: string): string {
  let folder: string;
  try {
    folder = new URL('./', page).href;
  } catch {
    return url;
  }
  if (!url.startsWith(folder)) return url;
  return url.slice(folder.length) || './';
}
