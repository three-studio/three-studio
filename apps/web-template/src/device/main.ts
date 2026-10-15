import { createId } from '@three-studio/core/ids';
import { isDeviceId } from '@three-studio/core/devices/protocol';
import { PLAYER_EVENT } from '../announce';
import { captureLogs } from './capture';
import { startDeviceClient, type DeviceNotice, type ProbeAnswer } from './client';
import { createLogQueue } from './logQueue';

/*
 * The device client: the script the device server puts first in the `<head>`
 * of every page it serves — the player's and the waiting page — and that no
 * export carries.
 *
 * A classic script, so that it runs before the player's module, which is
 * deferred: it listens before the player can say anything. Every URL here is
 * relative to the page, so it follows the page to whatever scheme and address
 * it was opened on.
 */

/*
 * The page's console, from its first line: this is the first statement of the
 * first script the page runs, before the device id, the launch or anything
 * else is read. Any later line — the player failing to boot, a script throwing
 * in its first frame — may be the one that explains a failure, and a line
 * logged before the capture would be gone for good. The lines wait here until
 * the server knows this device.
 */
const logs = createLogQueue();
const captured = captureLogs(window, (level, text) => logs.push(level, text));

/** Where a browser keeps its device id, so that a reload — and every tab — is the same device. */
const DEVICE_KEY = 'three-studio.device';

/** Set just before the editor's reload, and read once by the page it loads. */
const ASKED_KEY = 'three-studio.device.asked';

const NOTICES: Readonly<Record<DeviceNotice, string>> = {
  connected: 'Connected. When the editor launches, the game starts here.',
  stopped: 'Three Studio stopped serving. This page starts the game when it serves again.',
  unreachable: 'Three Studio cannot be reached. Trying again…',
  gone: 'This link no longer works: Three Studio made a new one. Scan its code again.',
};

/**
 * Read now: `currentScript` is this tag only while the script first runs.
 * Empty on the waiting page, which runs no launch.
 */
const launch = (document.currentScript as HTMLScriptElement | null)?.dataset['launch'] || null;

/**
 * This browser's id. `createId` rather than `crypto.randomUUID`, which only a
 * secure context has — and a phone on the network is not one. Storage may
 * refuse, in a private tab: the page is then a new device on each load, which
 * still works.
 */
function deviceId(): string {
  try {
    const kept = localStorage.getItem(DEVICE_KEY);
    if (isDeviceId(kept)) return kept;
    const made = createId(16);
    localStorage.setItem(DEVICE_KEY, made);
    return made;
  } catch {
    return createId(16);
  }
}

/** Whether the editor asked for this load, taken so that a reload by hand is not. */
function takeAsked(): boolean {
  try {
    const asked = sessionStorage.getItem(ASKED_KEY) !== null;
    sessionStorage.removeItem(ASKED_KEY);
    return asked;
  } catch {
    // Storage refused: the page keeps its Play screen, and a tap starts it.
    return false;
  }
}

/** Runs once the page's body exists: this script runs in `<head>`, before it. */
function whenParsed(run: () => void): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
}

/**
 * On the player's page, a bar at the bottom for the one thing worth saying
 * over a game: that its link is gone. It lets every touch through to the game,
 * and sits above the home indicator.
 */
function showBar(text: string): void {
  const bar = document.createElement('div');
  bar.textContent = text;
  bar.style.cssText = [
    'position: fixed',
    'left: 0',
    'right: 0',
    'bottom: 0',
    'padding: 8px 12px calc(8px + env(safe-area-inset-bottom, 0px))',
    'font: 13px/1.4 ui-sans-serif, system-ui, sans-serif',
    'color: #d6d6d6',
    'background: rgba(27, 27, 27, 0.92)',
    'text-align: center',
    'pointer-events: none',
    'z-index: 2147483647',
  ].join(';');
  document.body.append(bar);
}

function show(notice: DeviceNotice): void {
  whenParsed(() => {
    const state = document.getElementById('studio-state');
    if (state !== null) state.textContent = NOTICES[notice];
    else if (notice === 'gone') showBar(NOTICES.gone);
  });
}

async function probe(): Promise<ProbeAnswer> {
  try {
    const response = await fetch('./', { method: 'HEAD', cache: 'no-store' });
    if (response.status === 404) return 'gone';
    return response.ok ? 'here' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

const device = deviceId();

const client = startDeviceClient(
  {
    device,
    launch,
    asked: takeAsked(),
    identity: {
      userAgent: navigator.userAgent,
      screen: { width: screen.width, height: screen.height, dpr: devicePixelRatio },
      secureContext: isSecureContext,
    },
  },
  {
    openStream: ({ onOpen, onMessage, onError }) => {
      const source = new EventSource(`__studio/events?device=${device}`);
      source.onopen = () => onOpen();
      source.onmessage = (event: MessageEvent<string>) => onMessage(event.data);
      // `CLOSED` once the browser gave up: the server answered with an error.
      // Otherwise it is already retrying, after the delay the server set.
      source.onerror = () => onError(source.readyState === EventSource.CLOSED);
      return { close: () => source.close() };
    },
    post: (type, message) => {
      // `fetch`, never `sendBeacon` nor a form: those post in no-cors mode,
      // with an `Origin` of `null` the server cannot tell from another site's.
      // The referrer policy lets the browser name this page's origin even
      // though the server asks for no referrer on everything it sends.
      void fetch(`__studio/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
        referrerPolicy: 'same-origin',
        cache: 'no-store',
      }).catch(() => undefined);
    },
    probe,
    reload: () => {
      try {
        sessionStorage.setItem(ASKED_KEY, '1');
      } catch {
        // The page restarts on its Play screen instead.
      }
      location.reload();
    },
    reopen: (transport) => {
      // Only the scheme comes from the server; everything else is this page's
      // own. No mark for the next load: it lands on another origin, whose
      // storage cannot read this one's, so it shows its Play screen once.
      const url = new URL('./', location.href);
      url.protocol = `${transport}:`;
      location.replace(url.href);
    },
    show,
    // Through the console as it was, so that the client's own lines stay on
    // the device: the row already says what they say.
    log: (line) => captured.original.log(`[device] ${line}`),
  },
);

window.addEventListener(PLAYER_EVENT, (event) => client.playerAnnounced(event.detail));
// A phone that locked, a tab in the background, a page restored from the
// back-forward cache, a network back: each may have left a stream that looks
// open and is not.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') client.wake();
});
window.addEventListener('pageshow', () => client.wake());
window.addEventListener('online', () => client.wake());
