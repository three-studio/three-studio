import {
  DEVICE_HEARTBEAT_MS,
  DEVICE_PING_MS,
  DEVICE_PROTOCOL_VERSION,
  DEVICE_STREAM_TIMEOUT_MS,
  parseServerMessage,
  type DeviceBackend,
  type DeviceHello,
  type DeviceMessageType,
  type DeviceState,
  type DeviceStatusReport,
  type DeviceTransport,
  type ServerMessage,
} from '@three-studio/core/devices/protocol';
import type { PlayerAnnouncement } from '../announce';

/*
 * The link a served page keeps with the editor, without the page around it.
 *
 * Everything the browser does — the stream, the posts, the reload, the words
 * on screen — comes in through `io`, and the timers are the globals', so that
 * a test can fake all of it and check what is left: when the page says
 * hello, when it restarts, and when it gives up. `main.ts` is the browser's
 * side.
 */

/** What the page tells the person, when it can: the waiting page says each one, the game only `gone`. */
export type DeviceNotice = 'connected' | 'stopped' | 'unreachable' | 'gone';

/** What `HEAD ./` says about the link: the page is served, the token is gone, or nothing answered. */
export type ProbeAnswer = 'here' | 'gone' | 'unreachable';

/** The page as it loaded. */
export interface DevicePage {
  device: string;
  /** The launch the page runs, from its script tag; `null` on the waiting page. */
  launch: string | null;
  /** The editor asked for this load: the game starts without its Play screen. */
  asked: boolean;
  identity: Pick<DeviceHello, 'userAgent' | 'screen' | 'secureContext'>;
}

export interface StreamHandlers {
  onOpen: () => void;
  onMessage: (data: string) => void;
  /**
   * `closed` when the browser gave up on the stream for good — the server
   * answered it with an error — rather than lost it and retrying on its own.
   */
  onError: (closed: boolean) => void;
}

export interface DeviceIo {
  openStream: (handlers: StreamHandlers) => { close: () => void };
  post: (type: DeviceMessageType, message: DeviceHello | DeviceStatusReport) => void;
  probe: () => Promise<ProbeAnswer>;
  /** Marks the next load as asked for by the editor, then reloads. */
  reload: () => void;
  /** Opens this same page — host, port and path — under the other scheme. */
  reopen: (transport: DeviceTransport) => void;
  show: (notice: DeviceNotice) => void;
  log: (line: string) => void;
}

export interface DeviceClient {
  playerAnnounced: (detail: PlayerAnnouncement) => void;
  /** The page is back — visible again, restored, online — and its stream may have died meanwhile. */
  wake: () => void;
}

/** The first wait before asking again for a stream the server refused; doubled on each refusal. */
const FIRST_RETRY_MS = 3_000;
const LAST_RETRY_MS = 30_000;

/**
 * How long without a word before waking reopens the stream: longer than the
 * server's pings are apart, so that a stream that heard one lately is kept.
 */
const WAKE_SILENCE_MS = DEVICE_PING_MS + 5_000;

export function startDeviceClient(page: DevicePage, io: DeviceIo): DeviceClient {
  let state: DeviceState = page.launch === null ? 'waiting' : 'booting';
  let backend: DeviceBackend | null = null;
  let error: string | null = null;

  let stream: { close: () => void } | null = null;
  /** Counts streams, so that a late event from one already closed is told apart. */
  let generation = 0;
  let open = false;
  let lastHeard = Date.now();
  let silence: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = FIRST_RETRY_MS;
  let shown: DeviceNotice | null = null;
  /** Restarting, or the link is gone: nothing more is sent or heard. */
  let done = false;

  const hello = (): DeviceHello => ({
    v: DEVICE_PROTOCOL_VERSION,
    device: page.device,
    launch: page.launch,
    ...page.identity,
    state,
    backend,
    error,
  });

  const status = (): DeviceStatusReport => ({
    v: DEVICE_PROTOCOL_VERSION,
    device: page.device,
    state,
    backend,
    error,
  });

  /**
   * Says something new, and only something new. Once the editor said it
   * stopped, the errors that follow are that and not the network: they would
   * otherwise replace the one sentence that explains them.
   */
  const notice = (next: DeviceNotice): boolean => {
    if (next === shown || (next === 'unreachable' && shown === 'stopped')) return false;
    shown = next;
    io.show(next);
    return true;
  };

  /** Whatever came in proves the stream alive, and puts off reopening it. */
  const heard = (): void => {
    lastHeard = Date.now();
    clearTimeout(silence);
    silence = setTimeout(() => {
      io.log('No word from Three Studio for a while. Reconnecting.');
      connect();
    }, DEVICE_STREAM_TIMEOUT_MS);
  };

  const closeStream = (): void => {
    generation += 1;
    open = false;
    stream?.close();
    stream = null;
  };

  const finish = (): void => {
    done = true;
    closeStream();
    clearTimeout(silence);
    clearTimeout(retry);
    clearInterval(beat);
  };

  const receive = (message: ServerMessage | null): void => {
    switch (message?.type) {
      case 'launch':
        // Once: the page is going, and what it would hear meanwhile belongs
        // to the one that replaces it.
        io.log(`Restarting on launch ${message.launch}.`);
        finish();
        io.reload();
        return;
      case 'reopen':
        // The server is about to listen under the other scheme, and this
        // page's connections go with the one it leaves. Once, as for a launch.
        io.log(`Reopening over ${message.transport.toUpperCase()}.`);
        finish();
        io.reopen(message.transport);
        return;
      case 'stopped':
        if (notice('stopped')) io.log('Three Studio stopped serving.');
        return;
      default:
        // A ping, or something a newer server says: either way, the stream lives.
        return;
    }
  };

  /**
   * After a stream the server refused: the token may be gone, and nothing
   * else would say so — `EventSource` reports an error without its status.
   */
  const lost = (): void => {
    closeStream();
    clearTimeout(silence);
    const mine = generation;
    void io.probe().then((answer) => {
      // Woken meanwhile, and already on another stream.
      if (done || mine !== generation) return;
      if (answer === 'gone') {
        notice('gone');
        io.log('This link no longer works: Three Studio made a new one.');
        finish();
        return;
      }
      if (answer === 'unreachable' && notice('unreachable')) {
        io.log('Three Studio cannot be reached. Trying again.');
      }
      const delay = retryDelay;
      retryDelay = Math.min(retryDelay * 2, LAST_RETRY_MS);
      retry = setTimeout(connect, delay);
    });
  };

  function connect(): void {
    closeStream();
    clearTimeout(retry);
    const mine = generation;
    heard();
    stream = io.openStream({
      onOpen: () => {
        if (done || mine !== generation) return;
        open = true;
        retryDelay = FIRST_RETRY_MS;
        heard();
        if (notice('connected')) {
          io.log(
            page.launch === null
              ? 'Connected to Three Studio. Waiting for a launch.'
              : 'Connected to Three Studio.',
          );
        }
        io.post('hello', hello());
      },
      onMessage: (data) => {
        if (done || mine !== generation) return;
        heard();
        receive(parseServerMessage(data));
      },
      onError: (closed) => {
        if (done || mine !== generation) return;
        open = false;
        if (closed) {
          lost();
        } else if (notice('unreachable')) {
          // The browser retries on its own, every `retry` the server set.
          io.log('Lost Three Studio. Trying again.');
        }
      },
    });
  }

  // Only while a stream is open: with none, there is nobody to hear it, and
  // the hello of the next one says the same.
  const beat = setInterval(() => {
    if (open && !done) io.post('status', status());
  }, DEVICE_HEARTBEAT_MS);

  connect();

  return {
    playerAnnounced(detail) {
      if (done) return;
      if (detail.state === 'running') {
        state = 'running';
        backend = detail.backend;
        error = null;
        if (page.asked) {
          io.log('Started without the Play screen.');
          detail.start();
        }
      } else {
        state = 'failed';
        error = detail.error;
      }
      if (open) io.post('status', status());
    },
    wake() {
      if (done || Date.now() - lastHeard < WAKE_SILENCE_MS) return;
      io.log('Back after a while. Reconnecting.');
      connect();
    },
  };
}
