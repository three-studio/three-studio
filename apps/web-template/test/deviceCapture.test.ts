import { describe, expect, it, vi } from 'vitest';
import { captureLogs, relativeToPage, type CaptureScope } from '../src/device/capture';

/*
 * The page's console, as the device client captures it from the page's first
 * line. Node has no `ErrorEvent` nor `PromiseRejectionEvent`, so the events
 * below are plain ones carrying the fields a browser's would — which is all
 * the capture reads.
 */

const TOKEN = 'Ab3dE6gH9jK2mN5pQr7sT1';
const PAGE = `http://192.168.1.42:7700/${TOKEN}/`;

function fakeScope() {
  /** Every call, the console's and the sink's, in the order they came. */
  const heard: string[] = [];
  const recorder =
    (method: string) =>
    (...args: unknown[]) => {
      heard.push(`console.${method} ${args.join(' ')}`);
    };
  const console = {
    log: recorder('log'),
    info: recorder('info'),
    warn: recorder('warn'),
    error: recorder('error'),
    debug: recorder('debug'),
  };
  const target = new EventTarget();
  const scope: CaptureScope & { console: typeof console } = {
    console,
    location: { href: PAGE },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  };
  const sink = (level: string, text: string) => {
    heard.push(`sink ${level} ${text}`);
  };
  return { scope, target, heard, sink };
}

function uncaught(fields: Record<string, unknown>): Event {
  return Object.assign(new Event('error'), fields);
}

/** A resource that failed: the event is the element's, and the capture hears it on its way down. */
function failedToLoad(element: Record<string, unknown>): Event {
  const event = new Event('error');
  Object.defineProperty(event, 'target', { value: element });
  return event;
}

describe('the page’s console', () => {
  it('hands log, info, warn and error on, each after the console has written it', () => {
    const { scope, heard, sink } = fakeScope();
    captureLogs(scope, sink);

    scope.console.log('shout', { x: 1 });
    scope.console.info('ready');
    scope.console.warn('careful');
    scope.console.error(new Error('boom'));

    expect(heard).toEqual([
      'console.log shout [object Object]',
      'sink log shout {"x":1}',
      'console.info ready',
      'sink log ready',
      'console.warn careful',
      'sink warn careful',
      'console.error Error: boom',
      'sink error Error: boom',
    ]);
  });

  it('leaves debug alone', () => {
    const { scope, heard, sink } = fakeScope();
    const debug = scope.console.debug;
    captureLogs(scope, sink);

    scope.console.debug('every event');

    expect(scope.console.debug).toBe(debug);
    expect(heard).toEqual(['console.debug every event']);
  });

  it('writes an uncaught error with where it was thrown, from the page’s folder on', () => {
    const { scope, target, heard, sink } = fakeScope();
    captureLogs(scope, sink);

    target.dispatchEvent(
      uncaught({
        message: 'Uncaught Error: late boom',
        filename: `${PAGE}scripts.mjs`,
        lineno: 57,
        colno: 13,
      }),
    );

    expect(heard).toEqual(['sink error Uncaught Error: late boom (scripts.mjs:57:13)']);
    expect(heard.join('\n')).not.toContain(TOKEN);
  });

  it('writes an uncaught error alone when the browser names no file', () => {
    const { scope, target, heard, sink } = fakeScope();
    captureLogs(scope, sink);

    target.dispatchEvent(uncaught({ message: 'Script error.', filename: '', lineno: 0, colno: 0 }));

    expect(heard).toEqual(['sink error Script error.']);
  });

  it('says which file failed to load', () => {
    const { scope, target, heard, sink } = fakeScope();
    captureLogs(scope, sink);

    target.dispatchEvent(
      failedToLoad({ tagName: 'SCRIPT', src: `${PAGE}player/player-1a2b.js`, href: undefined }),
    );
    target.dispatchEvent(failedToLoad({ tagName: 'LINK', src: undefined, href: `${PAGE}x.css` }));

    expect(heard).toEqual([
      'sink error Failed to load script player/player-1a2b.js',
      'sink error Failed to load link x.css',
    ]);
  });

  it('writes an unhandled rejection with its reason', () => {
    const { scope, target, heard, sink } = fakeScope();
    captureLogs(scope, sink);

    target.dispatchEvent(
      Object.assign(new Event('unhandledrejection'), { reason: new Error('x') }),
    );

    expect(heard).toEqual(['sink error Unhandled rejection: Error: x']);
  });

  it('does not take again what is logged while a line is handed on', () => {
    const { scope, heard } = fakeScope();
    captureLogs(scope, (level, text) => {
      heard.push(`sink ${level} ${text}`);
      scope.console.log('from the sink');
    });

    scope.console.log('outside');

    expect(heard).toEqual(['console.log outside', 'sink log outside', 'console.log from the sink']);
  });

  it('never lets the page’s call fail for its sake', () => {
    const { scope, heard } = fakeScope();
    let broken = true;
    captureLogs(scope, (level, text) => {
      if (broken) {
        broken = false;
        throw new Error('sink broke');
      }
      heard.push(`sink ${level} ${text}`);
    });

    expect(() => scope.console.error('first')).not.toThrow();
    scope.console.error('second');

    expect(heard).toEqual(['console.error first', 'console.error second', 'sink error second']);
  });

  it('keeps the original methods, which write without being taken', () => {
    const { scope, heard, sink } = fakeScope();
    const captured = captureLogs(scope, sink);

    captured.original.log('[device] Connected to Three Studio.');
    captured.original.warn('[device] Lost Three Studio.');

    expect(heard).toEqual([
      'console.log [device] Connected to Three Studio.',
      'console.warn [device] Lost Three Studio.',
    ]);
  });

  it('puts every method back and stops listening when stopped', () => {
    const { scope, target, heard, sink } = fakeScope();
    const before = { ...scope.console };
    const captured = captureLogs(scope, sink);
    expect(scope.console.log).not.toBe(before.log);

    captured.stop();
    target.dispatchEvent(uncaught({ message: 'Uncaught Error: x', filename: '', lineno: 0 }));
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'no' }));

    expect(scope.console).toEqual(before);
    expect(heard).toEqual([]);
  });

  it('is only called once a line is complete', () => {
    const { scope } = fakeScope();
    const sink = vi.fn();
    captureLogs(scope, sink);

    scope.console.log('a', 1, [2]);

    expect(sink).toHaveBeenCalledOnce();
    expect(sink).toHaveBeenCalledWith('log', 'a 1 [2]');
  });
});

describe('a place in the page', () => {
  it('starts at the page’s folder, so that the token never shows', () => {
    expect(relativeToPage(`${PAGE}scripts.mjs`, PAGE)).toBe('scripts.mjs');
    expect(relativeToPage(`${PAGE}__studio/client.js`, `${PAGE}?x=1`)).toBe('__studio/client.js');
    expect(relativeToPage(PAGE, PAGE)).toBe('./');
  });

  it('keeps any other address as it is', () => {
    expect(relativeToPage('https://cdn.example/three.js', PAGE)).toBe('https://cdn.example/three.js');
    expect(relativeToPage('http://192.168.1.42:7700/other/x.js', PAGE)).toBe(
      'http://192.168.1.42:7700/other/x.js',
    );
  });
});
