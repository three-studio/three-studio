import {
  DEVICE_HEARTBEAT_MS,
  DEVICE_LOG_FLUSH_MS,
  DEVICE_PING_MS,
  DEVICE_PROTOCOL_VERSION,
  DEVICE_STREAM_TIMEOUT_MS,
  parseServerMessage,
  type DeviceBackend,
  type DeviceHello,
  type DeviceLogMessage,
  type DeviceMessageType,
  type DeviceState,
  type DeviceStats,
  type DeviceStatsReport,
  type DeviceStatusReport,
  type DeviceTransport,
  type ServerMessage,
} from '@three-studio/core/devices/protocol';
import { describeDeviceStats } from '@three-studio/core/devices/stats';
import type { PlayerAnnouncement } from '../announce';
import type { LogBatch, LogQueue } from './logQueue';
import type { StatsView } from './overlay';
import { createFrameWindow, readRenderer, type FrameWindow } from './stats';

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
  /**
   * The page before this one, in this tab, was ended in the foreground and
   * loaded again by the browser — on a phone, most likely for the memory it
   * used.
   */
  reloaded: boolean;
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

export interface PostOptions {
  /** The request outlives the page: for what waits as the page goes. */
  keepalive?: boolean;
}

/** The renderer the player announced: its counters, and the canvas it draws into. */
export type PlayerRenderer = Extract<PlayerAnnouncement, { state: 'running' }>['renderer'];

export interface DeviceIo {
  openStream: (handlers: StreamHandlers) => { close: () => void };
  /** Resolves the answer's status, or `0` when none came: the request failed on the way. */
  post: (
    type: DeviceMessageType,
    message: DeviceHello | DeviceStatusReport | DeviceLogMessage | DeviceStatsReport,
    options?: PostOptions,
  ) => Promise<number>;
  probe: () => Promise<ProbeAnswer>;
  /** Marks the next load as asked for by the editor, then reloads. */
  reload: () => void;
  /** Opens this same page — host, port and path — under the other scheme. */
  reopen: (transport: DeviceTransport) => void;
  show: (notice: DeviceNotice) => void;
  log: (line: string) => void;
  /** Calls `listener` in every frame the page draws, until the function it returns is called. */
  onFrame: (listener: (time: number) => void) => () => void;
  /** Draws the page's numbers in its corner; `null` takes them away. */
  stats: (view: StatsView | 'measuring' | null) => void;
  /** Whether the page is in front. */
  visible: () => boolean;
  /**
   * Reads the canvas the player draws into, as it is when called; the promise
   * is its encoding as a PNG, or `null` when the browser could not make one.
   */
  capture: (renderer: PlayerRenderer) => Promise<Blob | null>;
  /** Posts a frame under the request it answers. Resolves the answer's status, or `0` when none came. */
  upload: (request: string, image: Blob) => Promise<number>;
}

export interface DeviceClient {
  playerAnnounced: (detail: PlayerAnnouncement) => void;
  /** The page is back — visible again, restored, online — and its stream may have died meanwhile. */
  wake: () => void;
  /** A line joined the queue: it leaves with the next batch, a moment from now. */
  logged: () => void;
  /**
   * The page is going, or hidden, which on a phone may be the last moment it
   * runs: what waits leaves now, in a request that outlives the page.
   */
  pageHidden: () => void;
}

/** The first wait before asking again for a stream the server refused; doubled on each refusal. */
const FIRST_RETRY_MS = 3_000;
const LAST_RETRY_MS = 30_000;

/**
 * How long without a word before waking reopens the stream: longer than the
 * server's pings are apart, so that a stream that heard one lately is kept.
 */
const WAKE_SILENCE_MS = DEVICE_PING_MS + 5_000;

/** What the corner says under the numbers when the page is held at 30 fps. */
const HELD_30_WARNING = 'Held at 30 fps — power saving?';

function viewOf(stats: DeviceStats): StatsView {
  const { pace, scene, pixels } = describeDeviceStats(stats);
  return { lines: [pace, scene, pixels], warning: stats.pinned30 ? HELD_30_WARNING : null };
}

export function startDeviceClient(page: DevicePage, io: DeviceIo, logs: LogQueue): DeviceClient {
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
  /**
   * The hello posted on the current stream was answered: the server knows
   * this device, and lines may leave — before that, it would ignore them. A
   * launch leaves it set, so that the page's last lines still go as it
   * unloads; a stream lost, a reopen elsewhere or a link gone clear it.
   */
  let linked = false;
  /** Batches posted and not answered yet. */
  let sending = 0;
  let flush: ReturnType<typeof setTimeout> | undefined;
  /**
   * Said in each hello until one saying it is answered: a hello can be lost
   * or refused, and the server counts a reload once, for the device.
   */
  let reloaded = page.reloaded;
  /** The page's frames, measured once the player runs; `null` before, and on the waiting page. */
  let frames: FrameWindow | null = null;
  let stopFrames: (() => void) | null = null;
  /** The page's numbers are drawn in its corner, as the server's options say. */
  let showing = false;
  /** What the corner said last, so that it comes back as it was when shown again. */
  let view: StatsView | null = null;
  /** The renderer the player announced, whose canvas a screenshot reads; `null` until it runs. */
  let renderer: PlayerRenderer | null = null;
  /** The screenshot asked for, taken in the next frame the player draws; `null` when none is. */
  let armed: string | null = null;

  const hello = (): DeviceHello => ({
    v: DEVICE_PROTOCOL_VERSION,
    device: page.device,
    launch: page.launch,
    ...page.identity,
    state,
    backend,
    error,
    reloaded,
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

  const unlink = (): void => {
    linked = false;
    clearTimeout(flush);
    flush = undefined;
  };

  const finish = (): void => {
    done = true;
    armed = null;
    stopFrames?.();
    stopFrames = null;
    closeStream();
    clearTimeout(silence);
    clearTimeout(retry);
    clearTimeout(flush);
    flush = undefined;
    clearInterval(beat);
  };

  /** Posts a batch, and settles it by the answer. */
  const post = (batch: LogBatch, options?: PostOptions): void => {
    sending += 1;
    const message: DeviceLogMessage = {
      v: DEVICE_PROTOCOL_VERSION,
      device: page.device,
      launch: page.launch,
      ...batch,
    };
    void io.post('log', message, options).then((status) => {
      sending -= 1;
      if (status === 0) {
        // Lost on the way: tried again at the same pace while the stream
        // holds. Unlinking would keep every line until the stream next
        // breaks, which one answering its pings never does; a network that is
        // really gone breaks the stream too, and its next hello comes first.
        logs.putBack(batch);
      } else if (status !== 204) {
        logs.lose(batch);
      }
      later();
    });
  };

  /** The next batch, while linked, with none in flight. */
  const send = (): void => {
    clearTimeout(flush);
    flush = undefined;
    if (!linked || sending > 0) return;
    const batch = logs.take();
    if (batch !== null) post(batch);
  };

  /**
   * A batch `DEVICE_LOG_FLUSH_MS` from now, unless one is due already: the
   * first line after a quiet moment waits that long, so that a burst leaves
   * as one batch, and the batches that follow keep that pace.
   */
  const later = (): void => {
    if (!linked || done || flush !== undefined) return;
    flush = setTimeout(send, DEVICE_LOG_FLUSH_MS);
  };

  /** Every frame the player draws: a report every 2 s, posted while linked, drawn while shown. */
  const measure = (window: FrameWindow, drawing: PlayerRenderer, time: number): void => {
    const sample = window.frame(time);
    if (sample === null || done) return;
    const stats: DeviceStats = { ...sample, ...readRenderer(drawing) };
    view = viewOf(stats);
    if (showing) io.stats(view);
    // Not tried again when it fails: the next one is two seconds away.
    if (linked) {
      void io.post('stats', { v: DEVICE_PROTOCOL_VERSION, device: page.device, launch: page.launch, ...stats });
    }
  };

  /**
   * The frame the player has just drawn, copied for the screenshot asked for.
   *
   * Here, in the client's frame callback, and nowhere else: the player's loop
   * runs before this one in every frame, so the canvas holds the frame just
   * drawn and not yet shown — the one moment WebGL still keeps it, since three
   * asks it to keep nothing past the page's compositing. WebGPU keeps it until
   * the next frame begins, so the same moment does for both.
   */
  const capture = (window: FrameWindow, drawing: PlayerRenderer, request: string): void => {
    const { width, height } = drawing.domElement;
    const encoding = io.capture(drawing);
    // Copying the canvas stalls this frame on a phone: the measure starts
    // over rather than count it, as it does when the page comes back.
    window.restart();
    void encoding.then(async (image) => {
      // The page restarts, or goes elsewhere: the server gave up on it already.
      if (done) return;
      if (image === null) {
        io.log('Screenshot failed: the browser could not encode the frame.');
        return;
      }
      // Whether linked or not: the request came down the stream, and its id
      // is the upload's permission.
      const status = await io.upload(request, image);
      if (status === 204) io.log(`Screenshot sent (${width}×${height}).`);
      else if (status === 0) io.log('Screenshot lost on the way.');
      else io.log(`Screenshot refused (${status}).`);
    });
  };

  /** Every frame the player draws: the screenshot asked for, else the measure. */
  const frame = (window: FrameWindow, drawing: PlayerRenderer, time: number): void => {
    if (armed === null) {
      measure(window, drawing, time);
      return;
    }
    const request = armed;
    armed = null;
    capture(window, drawing, request);
  };

  /** Why this page has no frame to give, or `null` when it has one. */
  const noFrame = (): string | null => {
    if (page.launch === null) return 'the waiting page runs no game';
    if (state !== 'running' || renderer === null) return 'the game is not running';
    // Its browser draws no frame for a page behind another, or a phone locked.
    if (!io.visible()) return 'the page is hidden';
    return null;
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
        // The page that opens there is another device to it: these lines
        // stay with this one.
        io.log(`Reopening over ${message.transport.toUpperCase()}.`);
        unlink();
        finish();
        io.reopen(message.transport);
        return;
      case 'stopped':
        unlink();
        if (notice('stopped')) io.log('Three Studio stopped serving.');
        return;
      case 'options':
        // Every stream opens with them, so only a change is one. The waiting
        // page runs no game: it has nothing to measure, nor to draw.
        if (page.launch === null || message.stats === showing) return;
        showing = message.stats;
        io.log(showing ? 'Stats on screen.' : 'Stats off screen.');
        io.stats(showing ? (view ?? 'measuring') : null);
        return;
      case 'screenshot': {
        const why = noFrame();
        if (why !== null) {
          io.log(`Screenshot skipped: ${why}.`);
          return;
        }
        // One after another replaces it: the server no longer waits for that one.
        armed = message.request;
        return;
      }
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
    unlink();
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
    unlink();
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
        const said = hello();
        void io.post('hello', said).then((status) => {
          // Taken, whatever became of the stream since: the reload is counted.
          if (status === 204 && said.reloaded) reloaded = false;
          // Only for the stream it was posted on, and only while it is open:
          // an answer that arrives after the stream broke links nothing.
          if (done || mine !== generation || !open || status !== 204) return;
          linked = true;
          // What waits leaves at once: the page's first moments.
          send();
        });
      },
      onMessage: (data) => {
        if (done || mine !== generation) return;
        heard();
        receive(parseServerMessage(data));
      },
      onError: (closed) => {
        if (done || mine !== generation) return;
        open = false;
        unlink();
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
    if (open && !done) void io.post('status', status());
  }, DEVICE_HEARTBEAT_MS);

  connect();

  return {
    playerAnnounced(detail) {
      if (done) return;
      if (detail.state === 'running') {
        state = 'running';
        backend = detail.backend;
        error = null;
        if (frames === null) {
          const window = createFrameWindow();
          const drawing = detail.renderer;
          frames = window;
          renderer = drawing;
          stopFrames = io.onFrame((time) => frame(window, drawing, time));
        }
        if (page.asked) {
          io.log('Started without the Play screen.');
          detail.start();
        }
      } else {
        state = 'failed';
        error = detail.error;
      }
      if (open) void io.post('status', status());
    },
    wake() {
      if (done) return;
      // Its next frames are a page coming back, not yet the game's.
      frames?.restart();
      if (Date.now() - lastHeard < WAKE_SILENCE_MS) return;
      io.log('Back after a while. Reconnecting.');
      connect();
    },
    logged() {
      later();
    },
    pageHidden() {
      // A hidden page draws no frame to read: the server says so in 10 s.
      if (armed !== null) {
        armed = null;
        io.log('Screenshot skipped: the page is hidden.');
      }
      if (!linked) return;
      clearTimeout(flush);
      flush = undefined;
      // One batch, whether another is in flight or not: a browser lets the
      // requests that outlive a page carry 64 KB in all, and a batch may hold
      // 48. Lines leave every quarter of a second while linked, so what waits
      // here is the last moment's.
      const batch = logs.take();
      if (batch !== null) post(batch, { keepalive: true });
    },
  };
}
