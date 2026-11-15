import { createServer } from 'node:net';
import { isEntityId, isRecord, type EntityId } from '@three-studio/core';

/*
 * The Chrome DevTools Protocol, over Node's own `WebSocket` and `fetch`: the
 * editor (Electron) and Chrome both speak it, and a JSON message per frame
 * needs no dependency. Everything that arrives is `unknown` until decoded here.
 */

export type CdpMessage =
  | { readonly kind: 'reply'; readonly id: number; readonly result: Record<string, unknown> }
  | { readonly kind: 'error'; readonly id: number; readonly message: string }
  | { readonly kind: 'event'; readonly method: string; readonly params: Record<string, unknown> };

export function decodeCdpMessage(text: string): CdpMessage {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) throw new Error(`a CDP message that is not an object: ${text.slice(0, 120)}`);
  const id = value['id'];
  if (typeof id === 'number') {
    const error = value['error'];
    if (isRecord(error)) {
      const message = error['message'];
      return { kind: 'error', id, message: typeof message === 'string' ? message : JSON.stringify(error) };
    }
    const result = value['result'];
    return { kind: 'reply', id, result: isRecord(result) ? result : {} };
  }
  const method = value['method'];
  if (typeof method === 'string') {
    const params = value['params'];
    return { kind: 'event', method, params: isRecord(params) ? params : {} };
  }
  throw new Error(`a CDP message that is neither a reply nor an event: ${text.slice(0, 120)}`);
}

/** A field of a decoded record that has to be one, or a sentence saying which was not. */
export function recordAt(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) throw new Error(`expected an object at "${key}"`);
  return value;
}

export function stringAt(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw new Error(`expected a string at "${key}"`);
  return value;
}

export function numberAt(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number') throw new Error(`expected a number at "${key}"`);
  return value;
}

export function vec3At(record: Record<string, unknown>, key: string): [number, number, number] {
  const value = record[key];
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`expected three numbers at "${key}"`);
  const [x, y, z]: unknown[] = value;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') {
    throw new Error(`expected three numbers at "${key}"`);
  }
  return [x, y, z];
}

export function stringsAt(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`expected a list at "${key}"`);
  return value.map((entry: unknown, index) => {
    if (typeof entry !== 'string') throw new Error(`expected a string at "${key}[${index}]"`);
    return entry;
  });
}

/** An entity id out of a record that was kept as text between two launches. */
export function entityIdAt(record: Record<string, unknown>, key: string): EntityId {
  const value = record[key];
  if (!isEntityId(value)) throw new Error(`expected an entity id at "${key}"`);
  return value;
}

export function entityIdsAt(record: Record<string, unknown>, key: string): EntityId[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`expected a list at "${key}"`);
  return value.map((entry: unknown, index) => {
    if (!isEntityId(entry)) throw new Error(`expected an entity id at "${key}[${index}]"`);
    return entry;
  });
}

export interface CdpTarget {
  readonly type: string;
  readonly url: string;
  readonly webSocketDebuggerUrl: string;
}

/** `/json/list`, keeping what can be attached to. */
export function decodeTargets(value: unknown): CdpTarget[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (!isRecord(entry)) return [];
    const { type, url, webSocketDebuggerUrl } = entry;
    return typeof type === 'string' && typeof url === 'string' && typeof webSocketDebuggerUrl === 'string'
      ? [{ type, url, webSocketDebuggerUrl }]
      : [];
  });
}

/** What the debugging port lists, or `null` while nothing listens on it yet. */
export async function listTargets(port: number): Promise<CdpTarget[] | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    return decodeTargets(await response.json());
  } catch {
    return null;
  }
}

/** The browser's own endpoint, which `Browser.close` is sent to. */
export async function browserEndpoint(port: number): Promise<string | null> {
  try {
    const version: unknown = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    return isRecord(version) && typeof version['webSocketDebuggerUrl'] === 'string'
      ? version['webSocketDebuggerUrl']
      : null;
  } catch {
    return null;
  }
}

/**
 * A port nothing listens on, for `--remote-debugging-port`.
 *
 * Asked of the system rather than counted from a base, so two runs, or a run
 * beside an editor someone has open with its own port, cannot collide.
 */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address !== null && typeof address === 'object') resolve(address.port);
        else reject(new Error('no port came back'));
      });
    });
  });
}

interface Pending {
  readonly method: string;
  readonly resolve: (result: Record<string, unknown>) => void;
  readonly reject: (error: Error) => void;
}

/** One debugging connection: to a page, or to the browser. */
export class CdpSession {
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<string, Set<(params: Record<string, unknown>) => void>>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      const message = decodeCdpMessage(event.data);
      if (message.kind === 'event') {
        for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.kind === 'error') pending.reject(new Error(`${pending.method}: ${message.message}`));
      else pending.resolve(message.result);
    });
    // The app exiting closes the socket under a request; saying which one is
    // what makes the failure readable.
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error(`${pending.method}: the connection closed`));
      }
      this.pending.clear();
    });
  }

  static open(url: string): Promise<CdpSession> {
    const socket = new WebSocket(url);
    return new Promise((resolve, reject) => {
      socket.addEventListener('open', () => resolve(new CdpSession(socket)), { once: true });
      socket.addEventListener('error', () => reject(new Error(`could not connect to ${url}`)), { once: true });
    });
  }

  /**
   * One call, answered within `timeoutMs` or refused.
   *
   * Bounded because some calls never answer: `Page.captureScreenshot` hangs for
   * good in the uncapped mode, and an evaluate can wait on a page whose GPU
   * process is gone. Unbounded, a run waited for Vitest's own timeout, half an
   * hour, and left the app running behind it.
   */
  send(method: string, params: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<Record<string, unknown>> {
    this.nextId += 1;
    const id = this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: no answer within ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Every event of a method, until the returned function is called. */
  on(method: string, listener: (params: Record<string, unknown>) => void): () => void {
    const listeners = this.listeners.get(method) ?? new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
    return () => listeners.delete(listener);
  }

  close(): void {
    this.socket.close();
  }
}

/** A console argument or an exception as text: its value, or what DevTools would print for it. */
function remoteText(value: unknown): string {
  if (!isRecord(value)) return String(value);
  for (const key of ['value', 'description', 'text']) {
    const text = value[key];
    if (typeof text === 'string') return text;
  }
  return JSON.stringify(value);
}

/**
 * The page's console errors and uncaught exceptions, as they come. Call before
 * `Runtime.enable`, which replays what the console already holds.
 */
export function collectErrors(session: CdpSession): readonly string[] {
  const errors: string[] = [];
  session.on('Runtime.consoleAPICalled', (params) => {
    if (params['type'] !== 'error') return;
    const args: unknown = params['args'];
    errors.push(Array.isArray(args) ? args.map(remoteText).join(' ') : '');
  });
  session.on('Runtime.exceptionThrown', (params) => {
    const details = params['exceptionDetails'];
    errors.push(isRecord(details) ? remoteText(details['exception'] ?? details) : remoteText(details));
  });
  return errors;
}

/*
 * Page functions: TypeScript functions run in a page through `Runtime.evaluate`.
 *
 * Serialised with `toString()`, so what a function may use is narrow, and
 * `test/pageFunctions.test.ts` holds every one to it: no import but types, no
 * helper from its own module's scope, and no transform helper in its source. A
 * page function that read an imported value would come out of Vitest's
 * transform as `__vite_ssr_import_0__.x`, which does not exist in the page.
 * What it answers is decoded on the way back, one decoder per shape.
 */

/** What in a page function's source would not survive being run elsewhere. */
export function pageFunctionProblems(source: string, moduleNames: readonly string[], ownName: string): string[] {
  const problems: string[] = [];
  for (const helper of ['__vite_ssr_', '__vi_', '__name']) {
    if (source.includes(helper)) problems.push(`carries the transform helper ${helper}`);
  }
  for (const name of moduleNames) {
    if (name !== ownName && new RegExp(`\\b${name}\\b`).test(source)) problems.push(`reads ${name} from its module`);
  }
  return problems;
}

/**
 * Runs `fn(arg)` in the page and answers what it returned, undecoded. Throws
 * what the page threw, and refuses after `timeoutMs` — a function that waits
 * on a load passes the time the load may take.
 */
export async function runInPage<A>(
  session: CdpSession,
  fn: (arg: A) => unknown,
  arg: A,
  timeoutMs = 120_000,
): Promise<unknown> {
  const reply = await session.send(
    'Runtime.evaluate',
    {
      expression: `(${fn.toString()})(${JSON.stringify(arg) ?? 'undefined'})`,
      awaitPromise: true,
      returnByValue: true,
    },
    timeoutMs,
  );
  const thrown = reply['exceptionDetails'];
  if (isRecord(thrown)) {
    const exception = thrown['exception'];
    const description = isRecord(exception) ? exception['description'] : undefined;
    throw new Error(`${fn.name || 'a page function'} threw: ${typeof description === 'string' ? description : String(thrown['text'])}`);
  }
  return recordAt(reply, 'result')['value'];
}

/** A page function's numbers. Anything that is not one is refused, naming the key. */
export function decodeNumbers(value: unknown): Record<string, number> {
  if (!isRecord(value)) throw new Error('a page function answered something that is not an object');
  const numbers: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) throw new Error(`"${key}" is not a number: ${String(entry)}`);
    numbers[key] = entry;
  }
  return numbers;
}

/** A page function's list of numbers: frame deltas. */
export function decodeNumberList(value: unknown): number[] {
  if (!Array.isArray(value)) throw new Error('a page function answered something that is not a list');
  return value.map((entry: unknown, index) => {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) throw new Error(`entry ${index} is not a number: ${String(entry)}`);
    return entry;
  });
}

/** A page function's list of strings. */
export function decodeStrings(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('a page function answered something that is not a list');
  return value.map((entry: unknown, index) => {
    if (typeof entry !== 'string') throw new Error(`entry ${index} is not a string: ${String(entry)}`);
    return entry;
  });
}
