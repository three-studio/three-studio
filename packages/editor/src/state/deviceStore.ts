import type {
  DeviceLogs,
  DeviceServerStatus,
  LaunchSnapshot,
  PortHolder,
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
  ownLaunch: { id: string; snapshot: LaunchSnapshot } | null;
}

export const useDeviceStore = create<DeviceState>()(() => ({
  status: null,
  popoverOpen: false,
  ownLaunch: null,
}));

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
    if (heard === before) useDeviceStore.setState({ status });
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
  });
  const unsubscribeLogs = window.studio.devices.onLog(appendDeviceLogs);
  void read();
  return () => {
    unsubscribe();
    unsubscribeLogs();
  };
}

/**
 * A device as its row and its Console lines both say it: `iPhone · Safari`.
 * The same words in both places, so that typing what a row says into the
 * Console's Filter finds that device's lines.
 */
export function deviceLabel({ name, browser }: { name: string; browser: string }): string {
  return `${name} · ${browser}`;
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
