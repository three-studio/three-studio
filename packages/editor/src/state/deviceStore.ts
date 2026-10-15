import {
  deviceLabel,
  type DeviceLogs,
  type DeviceServerStatus,
  type LaunchSnapshot,
  type PortHolder,
} from '@three-studio/core';
import { create } from 'zustand';
import { useConsoleStore, type LogLine } from './consoleStore';

/**
 * The device server, as this window last heard of it.
 *
 * Held here rather than asked for: the server lives in the main process, one
 * per app, and any window — or a project's script — can start or stop it. The
 * main process sends every change to every editor window, so this is the one
 * copy the toolbar, the status bar and the commands read.
 */
interface DeviceState {
  /** `null` until the first reading arrives. */
  status: DeviceServerStatus | null;
  /**
   * Whether this window's device popover is open. Here rather than in the
   * button, so that the launch toast's *Show QR Code* can open it too.
   */
  popoverOpen: boolean;
  /**
   * The last launch this window made that became current: its id, and the
   * snapshot it sent. Whether the devices still run this window's scene is
   * the server's current launch being this one — a launch from another
   * window replaces it there, never here. `null` until this window launches.
   */
  ownLaunch: OwnLaunch | null;
  /**
   * Why live reload stopped relaunching: the refusal of its last relaunch, or
   * `null`. Mostly scripts that do not compile — files, which no change in
   * the editor fixes — so a retry on every pause would be refused every time.
   * A launch from this window that succeeds clears it, and so does turning
   * live reload on again.
   */
  liveReloadRefused: string | null;
  /**
   * How many reloads nobody asked for each device had, by id, as this window
   * last read them; `null` before its first reading. What a reload adds to
   * the Console is told from it.
   */
  notedReloads: Readonly<Record<string, number>> | null;
}

/** A launch this window made, and what it sent. */
export interface OwnLaunch {
  id: string;
  snapshot: LaunchSnapshot;
}

export const useDeviceStore = create<DeviceState>()(() => ({
  status: null,
  popoverOpen: false,
  ownLaunch: null,
  liveReloadRefused: null,
  notedReloads: null,
}));

/**
 * What live reload is doing in this window:
 * - `off`: the setting is off, or the server has not been read yet;
 * - `idle`: on, with the server stopped or nothing launched;
 * - `elsewhere`: on, while the devices run another window's launch — each
 *   window holds one scene, and the phones follow the window that launched;
 * - `paused`: on, held by a refusal;
 * - `on`: relaunching a second after each change.
 */
export type LiveReloadState = 'off' | 'idle' | 'elsewhere' | 'paused' | 'on';

export function liveReloadState(
  status: DeviceServerStatus | null,
  ownLaunch: Pick<OwnLaunch, 'id'> | null,
  refused: string | null,
): LiveReloadState {
  if (status === null || !status.liveReload) return 'off';
  if (status.state !== 'running' || status.launch === null) return 'idle';
  if (ownLaunch === null || ownLaunch.id !== status.launch.id) return 'elsewhere';
  return refused === null ? 'on' : 'paused';
}

export function showDevicePopover(): void {
  useDeviceStore.setState({ popoverOpen: true });
}

export function setDevicePopoverOpen(open: boolean): void {
  useDeviceStore.setState({ popoverOpen: open });
}

/** How many changes this window has heard, so a reading can tell one arrived while it was on its way. */
let heard = 0;

/**
 * Asks for the status, and keeps the answer only if no change arrived while
 * it was on its way: a change sent meanwhile is newer, and the reading would
 * put the window back in the past — a server shown stopped that has just
 * started.
 */
async function read(): Promise<void> {
  const before = heard;
  try {
    const status = await window.studio.devices.status();
    if (heard !== before) return;
    useDeviceStore.setState({ status });
    noteLaunch(status);
    noteReloads(status);
  } catch {
    // Nothing to show without one; the next change will say.
  }
}

/**
 * Follows the server: every change, and one reading to start from, and every
 * line a device logs. Returns the unsubscribe, which ends both.
 */
export function watchDevices(): () => void {
  const unsubscribe = window.studio.devices.onChanged((status) => {
    heard += 1;
    useDeviceStore.setState({ status });
    noteLaunch(status);
    noteReloads(status);
  });
  const unsubscribeLogs = window.studio.devices.onLog(appendDeviceLogs);
  void read();
  return () => {
    unsubscribe();
    unsubscribeLogs();
  };
}

/** The launch whose devices' lines the Console holds: the last one noted. */
let notedLaunch: string | null = null;

/**
 * Takes every device's lines out of the Console when a new launch becomes
 * current — by hand or by live reload, from this window or another. The
 * editor's own lines stay.
 *
 * Every relaunch makes every phone log its first lines again, and two phones
 * interleave, so nothing folds: a minute of retouching with live reload on
 * would fill the Console with the same start-up lines, and push the editor's
 * own out. ↻ and a change of transport keep the launch, and its lines. A
 * status with no launch — the server stopped — changes nothing: the lines of
 * the last run are still worth reading.
 *
 * Called with every status this window hears, and with what its own launch
 * resolved, so that the lines go before that launch's own Console entry
 * lands, whichever arrives first.
 */
export function noteLaunch(status: DeviceServerStatus): void {
  const id = status.launch?.id ?? null;
  if (id === null || id === notedLaunch) return;
  notedLaunch = id;
  useConsoleStore.getState().clearDeviceEntries();
}

/**
 * Says in the Console, once, each reload nobody asked for: a page its browser
 * ended in the foreground and loaded again — on a phone, most likely for the
 * memory it used. The row says it for as long as the device is listed; the
 * Console says when.
 *
 * Through `console.warn`, so the line is this window's own: each launch takes
 * the devices' lines out of the Console, and this one, about a device rather
 * than from it, stays. The first status a window reads is only remembered: a
 * reload that happened before the window opened is the row's to show, and a
 * line about it now would say it happened now.
 */
export function noteReloads(status: DeviceServerStatus): void {
  const before = useDeviceStore.getState().notedReloads;
  const counts: Record<string, number> = {};
  for (const device of status.devices) counts[device.id] = device.reloads;
  useDeviceStore.setState({ notedReloads: counts });
  if (before === null) return;
  for (const device of status.devices) {
    // A device listed anew counts from nothing.
    if (device.reloads <= (before[device.id] ?? 0)) continue;
    console.warn(
      `${deviceLabel(device)}: the page ended without warning and was reloaded — ` +
        'it most likely ran out of memory.',
    );
  }
}

/**
 * A device's batch of lines, into the Console under the device's label, with
 * one warning when lines were lost on the way.
 *
 * Straight into the Console's store, never through `console.*`: the editor's
 * own capture would take the lines in again as this window's, the smoke
 * harness counts every `console.error` of the window as the editor failing,
 * and the window's devtools would show a phone's lines as its own.
 */
export function appendDeviceLogs(logs: DeviceLogs): void {
  const lines: LogLine[] = [...logs.lines];
  // After the batch's own lines: what a page loses is mostly what it logged
  // last, once its queue was full.
  if (logs.dropped > 0) lines.push({ level: 'warn', text: droppedText(logs.dropped), count: 1 });
  useConsoleStore.getState().appendMany({ id: logs.device, label: deviceLabel(logs) }, lines);
}

function droppedText(dropped: number): string {
  const lost =
    dropped === 1 ? '1 line from this device was' : `${dropped} lines from this device were`;
  return `${lost} dropped before reaching the editor: it logged more than the link carries.`;
}

/**
 * Reads the server again. Its addresses are read anew on every status, and
 * nothing else announces that this computer joined another Wi-Fi while the
 * server ran.
 */
export function refreshDevices(): Promise<void> {
  return read();
}

/** Running on another port than the one the settings keep, because something held that one. */
export function hasSlid(status: DeviceServerStatus | null): status is DeviceServerStatus {
  return status?.state === 'running' && status.port !== status.requestedPort;
}

/** A holder as a sentence names it: the toast and the popover say it the same way. */
export function holderName(holder: PortHolder | null): string {
  if (holder === null) return 'another program';
  if (holder.sameApp) return `another Three Studio (process ${holder.pid})`;
  const program = holder.program === null ? 'a program' : holder.program.split(/[\\/]/).at(-1);
  return `${program} (process ${holder.pid})`;
}

/**
 * The link a phone opens: the selected one while the server runs — unless it
 * is this computer's own, which no phone can open.
 */
export function deviceLink(status: DeviceServerStatus | null): string | null {
  if (status?.state !== 'running') return null;
  const selected = status.urls.find((url) => url.url === status.selectedUrl);
  return selected === undefined || selected.address === 'localhost' ? null : selected.url;
}

/** The link this computer opens, over `localhost`, while the server runs. */
export function localDeviceUrl(status: DeviceServerStatus | null): string | null {
  if (status?.state !== 'running') return null;
  return status.urls.find((url) => url.address === 'localhost')?.url ?? null;
}
