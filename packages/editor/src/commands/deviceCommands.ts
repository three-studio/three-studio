import type {
  DeviceInfo,
  DeviceLaunchOptions,
  DeviceServerStatus,
  DeviceTransport,
  LaunchSnapshot,
} from '@three-studio/core';
import { useConsoleStore, type LogLevel } from '../state/consoleStore';
import {
  deviceLink,
  hasSlid,
  holderName,
  localDeviceUrl,
  noteLaunch,
  showDevicePopover,
  useDeviceStore,
} from '../state/deviceStore';
import { askForText, askToConfirm } from '../state/dialogStore';
import { useProjectStore } from '../state/projectStore';
import { useToastStore, type ToastInput } from '../state/toastStore';
import { launchSnapshot } from '../viewport/PlaySession';
import { defineCommand } from './command';
import { ipcErrorMessage } from './ipcError';

/*
 * Running what is on screen on a phone: the device server, from the palette.
 *
 * Every link goes to the Console as well as to a toast. A toast goes after a
 * few seconds, and a link is something a person types on a phone, a word at a
 * time; the Console keeps it, in rows that can be selected and copied.
 */

/** Said by a launch that had no device to restart: what makes a phone one. */
const NO_DEVICE = 'Open the link on a phone: it restarts on every launch.';

/** The same, under HTTPS, where a phone has a warning to get past first. */
const NO_DEVICE_HTTPS =
  'Open the link on a phone and accept its certificate once: it restarts on every launch.';

const NO_NETWORK = 'No network address — only this computer can reach it.';

function isRunning(status: DeviceServerStatus | null): boolean {
  return status?.state === 'running';
}

/** What a person types to see what holds a port, the system's own way. */
function holderCommand(port: number): string {
  return window.studio.platform === 'win32'
    ? `netstat -ano | findstr :${port}`
    : `lsof -nP -iTCP:${port} -sTCP:LISTEN`;
}

/** What is wrong with where devices are served, worst first; empty when nothing is. */
function warningsOf(status: DeviceServerStatus): string[] {
  const warnings: string[] = [];
  if (hasSlid(status)) {
    warnings.push(
      `Port ${status.requestedPort} is held by ${holderName(status.portHolder)}, ` +
        `so devices are served on ${status.port}.`,
    );
  }
  if (!status.urls.some((url) => url.address !== 'localhost')) warnings.push(NO_NETWORK);
  return warnings;
}

/** Every link with what it is on, in a column that lines up. */
function urlLines(status: DeviceServerStatus): string[] {
  const width = Math.max(0, ...status.urls.map((url) => url.label.length));
  return status.urls.map((url) => `  ${url.label.padEnd(width)}  ${url.url}`);
}

/**
 * Where devices are served, as a toast: the link to type, or what is wrong.
 *
 * A warning stays until it is dismissed, since its point is to be read, and
 * opens its details, where the links are. A slid port held by another Three
 * Studio carries the one action that fixes it — which the palette offers as
 * well, as *Take Back Port*, so the toast is never the only way to it. A link
 * a phone can open carries its code, which the button's chevron shows too.
 * `notes` go after the links: what a launch did with the devices.
 */
function servedToast(
  status: DeviceServerStatus,
  title: string,
  notes: readonly string[],
  reclaim: () => void,
): ToastInput {
  const warnings = warningsOf(status);
  const quit = hasSlid(status) && status.portHolder?.sameApp === true;
  return {
    kind: warnings.length > 0 ? 'warning' : 'success',
    title,
    description: warnings[0] ?? status.selectedUrl ?? undefined,
    progress: undefined,
    details: [
      ...warnings.slice(1),
      ...(warnings.length > 1 ? [''] : []),
      ...urlLines(status),
      ...(notes.length > 0 ? ['', ...notes] : []),
    ].join('\n'),
    detailsOpen: warnings.length > 0,
    actions: [
      ...(quit ? [{ label: 'Quit the Other Three Studio', primary: true, onClick: reclaim }] : []),
      ...(deviceLink(status) === null
        ? []
        : [{ label: 'Show QR Code', primary: !quit, onClick: showDevicePopover }]),
    ],
  };
}

/**
 * Says where devices are served — in the toast given, or a new one — and in
 * the Console, where it stays: the links, and for a port held by a program
 * this editor will not quit, the command that names it.
 */
function showServed(
  status: DeviceServerStatus,
  title: string,
  notes: readonly string[],
  toastId?: string,
): void {
  let id = toastId;
  const toast = servedToast(status, title, notes, () => void reclaimDevicePort(id));
  if (id === undefined) id = useToastStore.getState().push(toast);
  else useToastStore.getState().update(id, toast);

  const warnings = warningsOf(status);
  const lines = [`${title}.`, ...warnings, ...urlLines(status), ...notes];
  if (hasSlid(status) && status.portHolder?.sameApp !== true) {
    lines.push(`To see what holds port ${status.requestedPort}: ${holderCommand(status.requestedPort)}`);
  }
  const level: LogLevel = warnings.length > 0 ? 'warn' : 'log';
  useConsoleStore.getState().append(level, lines.join('\n'));
}

/** A refusal from the main process: its first line in the toast, the whole of it behind the details and in the Console. */
function showFailure(title: string, cause: unknown, toastId?: string): void {
  const message = ipcErrorMessage(cause);
  const toast: ToastInput = {
    kind: 'error',
    title,
    description: message.split('\n')[0],
    progress: undefined,
    details: message,
    detailsOpen: false,
    actions: [],
  };
  if (toastId === undefined) useToastStore.getState().push(toast);
  else useToastStore.getState().update(toastId, toast);
  useConsoleStore.getState().append('error', `${title}: ${message}`);
}

/** The devices a launch reached: those with a stream, every one of which it told to restart. */
function connectedDevices(status: DeviceServerStatus): DeviceInfo[] {
  return status.devices.filter((device) => device.connected);
}

/** `Launched “Level 1” on 2 devices`, or without a count when no device was there to restart. */
function launchedTitle(status: DeviceServerStatus, verb = 'Launched'): string {
  const name = `“${status.launch?.sceneName ?? 'Scene'}”`;
  const count = connectedDevices(status).length;
  if (count === 0) return `${verb} ${name}`;
  return `${verb} ${name} on ${count} ${count === 1 ? 'device' : 'devices'}`;
}

/**
 * What a launch did with the devices: the ones it restarted, by name and
 * address — two phones of one kind are told apart by where they are — or,
 * with none, how a phone becomes one.
 */
function launchedNotes(status: DeviceServerStatus): string[] {
  const devices = connectedDevices(status);
  if (devices.length === 0) return [status.transport === 'https' ? NO_DEVICE_HTTPS : NO_DEVICE];
  const names = devices.map((device) => `${device.name} · ${device.browser} (${device.address})`);
  return [`Restarting ${names.join(', ')}.`];
}

/**
 * The one call that launches, by hand or for live reload. A launch that became
 * current is this window's, kept with the snapshot it sent, and lifts a pause
 * of live reload: a launch got through. The devices' lines of the launches
 * before it leave the Console here, before the caller says what happened.
 * `null` — a newer launch, from any window, or a stop dropped it while it was
 * prepared — leaves everything as it was.
 */
async function sendLaunch(snapshot: LaunchSnapshot): Promise<DeviceServerStatus | null> {
  const status = await window.studio.devices.launch(snapshot);
  if (status === null) return null;
  const launch = status.launch;
  if (launch !== null) {
    useDeviceStore.setState({ ownLaunch: { id: launch.id, snapshot }, liveReloadRefused: null });
  }
  noteLaunch(status);
  return status;
}

/**
 * Serves what is on screen to devices: what Play would run, unsaved edits
 * included, with nothing saved.
 *
 * One toast for the whole of it, as an export has: the launch takes a compile
 * and a scan, and the running message becomes the result.
 */
export async function launchOnDevices(): Promise<void> {
  const id = useToastStore
    .getState()
    .push({ kind: 'progress', title: 'Launching on devices…', progress: null });
  try {
    const status = await sendLaunch(launchSnapshot());
    if (status === null) {
      // Dropped: the newer launch reports for itself, and a stop was asked
      // for. Nothing of this one happened, so nothing is said of it.
      useToastStore.getState().dismiss(id);
      return;
    }
    showServed(status, launchedTitle(status), launchedNotes(status), id);
  } catch (cause) {
    showFailure('Could not launch on devices', cause, id);
  }
}

/**
 * Relaunches what is on screen, for live reload — a second after each change,
 * so quietly: no toast, and one Console line, which folds into the one before
 * it when nothing came between them. Not in the table below: its argument is
 * the snapshot live reload read, and only live reload dispatches it. Never
 * rejects.
 *
 * A refusal is said once, then holds live reload until a launch from this
 * window succeeds. What refuses a launch is mostly scripts that do not
 * compile: files, which no change in the editor fixes, so a relaunch on every
 * pause would be refused — and a toast raised — every time.
 */
export async function relaunchOnDevices(snapshot: LaunchSnapshot): Promise<void> {
  let status: DeviceServerStatus | null;
  try {
    status = await sendLaunch(snapshot);
  } catch (cause) {
    const message = ipcErrorMessage(cause);
    useDeviceStore.setState({ liveReloadRefused: message });
    useToastStore.getState().push({
      kind: 'error',
      title: 'Live reload paused',
      description: message.split('\n')[0],
      progress: undefined,
      details: message,
      detailsOpen: false,
      actions: [{ label: 'Launch', primary: true, onClick: () => void launchOnDevices() }],
    });
    useConsoleStore
      .getState()
      .append('error', `Live reload paused — the launch was refused: ${message}`);
    return;
  }
  if (status !== null) useConsoleStore.getState().append('log', launchedTitle(status, 'Relaunched'));
}

/**
 * Restarts one device on the current launch: ↻ on its row. Not in the table
 * below: its argument is a row's, and only a row can dispatch it. Says nothing
 * when it works — the row already shows the device starting.
 */
export async function restartDevice(id: string): Promise<void> {
  try {
    await window.studio.devices.restart(id);
  } catch (cause) {
    showFailure('Could not restart the device', cause);
  }
}

export async function stopDeviceServer(): Promise<void> {
  try {
    await window.studio.devices.stop();
    useToastStore.getState().push({ kind: 'info', title: 'Device server stopped' });
    useConsoleStore.getState().append('log', 'Device server stopped.');
  } catch (cause) {
    showFailure('Could not stop the device server', cause);
  }
}

/**
 * Why a port cannot be the device server's, or `null`.
 *
 * From 1024: below that, Linux asks for administrator rights to listen, and a
 * server that cannot start on the port it was given is a failure found later
 * than now. A file edited by hand may still name one.
 */
function portProblem(value: string): string | null {
  const text = value.trim();
  const port = Number(text);
  return /^\d+$/.test(text) && port >= 1024 && port <= 65535
    ? null
    : 'A port is a whole number from 1024 to 65535.';
}

/**
 * Chooses the port a phone's link names. Kept for every project and every run;
 * a running server moves onto it at once.
 */
export async function chooseDevicePort(): Promise<void> {
  let current: DeviceServerStatus;
  try {
    current = useDeviceStore.getState().status ?? (await window.studio.devices.status());
  } catch (cause) {
    showFailure('Could not read the device server', cause);
    return;
  }
  const answer = await askForText({
    title: 'Device Server Port',
    label: 'Port',
    defaultValue: String(current.requestedPort),
    confirmLabel: 'Save',
    validate: portProblem,
  });
  if (answer === null) return;

  try {
    const status = await window.studio.devices.saveSettings({ port: Number(answer.trim()) });
    if (isRunning(status)) {
      showServed(status, `Devices are served on port ${status.port}`, []);
    } else {
      useToastStore.getState().push({
        kind: 'info',
        title: `The device server will listen on port ${status.requestedPort}`,
      });
    }
  } catch (cause) {
    showFailure('Could not change the port', cause);
  }
}

/**
 * Moves a server that slid back onto the port its links name.
 *
 * The main process asks before it quits another Three Studio, and does
 * nothing more when the answer is no — nor does this. From the launch's toast,
 * that toast becomes the launch's success at the kept port.
 */
export async function reclaimDevicePort(toastId?: string): Promise<void> {
  const kept = useDeviceStore.getState().status?.requestedPort;
  try {
    const status = await window.studio.devices.reclaimPort();
    // Declined, or the server went meanwhile: nothing moved, nothing to say.
    if (!isRunning(status) || status.port !== status.requestedPort) return;
    if (status.launch === null) {
      showServed(status, `Devices are served on port ${status.port}`, [], toastId);
    } else {
      showServed(status, launchedTitle(status), launchedNotes(status), toastId);
    }
  } catch (cause) {
    const title = kept === undefined ? 'Could not take back the port' : `Could not take back port ${kept}`;
    showFailure(title, cause, toastId);
  }
}

/** Puts the link a phone opens on the clipboard: for a message, a note, a phone the code cannot reach. */
export async function copyDeviceLink(): Promise<void> {
  const link = deviceLink(useDeviceStore.getState().status);
  if (link === null) return;
  try {
    await navigator.clipboard.writeText(link);
    useToastStore.getState().push({ kind: 'info', title: 'Device link copied', description: link });
  } catch (cause) {
    // Chromium refuses a window that does not have the focus.
    showFailure('Could not copy the device link', cause);
  }
}

/**
 * Opens the page in this computer's browser, over `localhost`: a browser
 * treats `localhost` as a secure context, which a network address is not. The
 * window's own handler hands the link to the system. Under HTTPS the link
 * follows, and that browser asks once to accept the certificate, as a phone
 * does.
 */
export function openDevicePage(): void {
  const url = localDeviceUrl(useDeviceStore.getState().status);
  if (url !== null) window.open(url, '_blank', 'noopener');
}

/**
 * Replaces the link with a new one, once the person agrees: the way to take
 * back a link that leaked — a screenshot of the code is enough.
 */
export async function newDeviceLink(): Promise<void> {
  const confirmed = await askToConfirm({
    title: 'Make a new device link?',
    message:
      'The current link stops working at once. Every device that saved it — a bookmark, ' +
      'a home-screen icon — needs the new one.',
    confirmLabel: 'Make New Link',
    destructive: true,
  });
  if (!confirmed) return;

  try {
    const status = await window.studio.devices.regenerateToken();
    if (!isRunning(status)) {
      useToastStore.getState().push({
        kind: 'info',
        title: 'New device link',
        description: 'It takes effect when the server starts.',
      });
      return;
    }
    const link = deviceLink(status) ?? localDeviceUrl(status);
    useToastStore.getState().push({
      kind: 'info',
      title: 'New device link',
      description: link ?? undefined,
    });
    useConsoleStore.getState().append('log', ['New device link.', ...urlLines(status)].join('\n'));
  } catch (cause) {
    showFailure('Could not make a new device link', cause);
  }
}

/**
 * Picks the address the link is made of; `null` gives the choice back to the
 * server. Not in the table below: its argument is a value the address picker
 * produced, and only the picker can dispatch it.
 */
export async function chooseDeviceAddress(address: string | null): Promise<void> {
  try {
    await window.studio.devices.saveSettings({ address });
  } catch (cause) {
    showFailure('Could not change the address', cause);
  }
}

/** What a toast calls a transport. */
const TRANSPORT_NAMES: Readonly<Record<DeviceTransport, string>> = { http: 'HTTP', https: 'HTTPS' };

/**
 * Picks the protocol devices are served over. Not in the table below: its
 * argument is a value the protocol picker produced, and only the picker can
 * dispatch it.
 *
 * A running server listens again at once, and every page connected follows
 * it by itself. A page that was not connected holds a link in the old scheme,
 * which the port no longer speaks: it needs the new code. The new links go to
 * the Console, as every link does.
 */
export async function chooseDeviceTransport(transport: DeviceTransport): Promise<void> {
  const name = TRANSPORT_NAMES[transport];
  let status: DeviceServerStatus;
  try {
    status = await window.studio.devices.saveSettings({ transport });
  } catch (cause) {
    showFailure('Could not change the protocol', cause);
    return;
  }
  if (!isRunning(status)) {
    useToastStore.getState().push({
      kind: 'info',
      title: `Devices will be served over ${name}`,
      description: 'It takes effect when the server starts.',
    });
    return;
  }
  useToastStore.getState().push({
    kind: 'info',
    title: `Serving devices over ${name}`,
    description:
      transport === 'https'
        ? 'Connected devices reopen the page by themselves, and each one asks once to accept ' +
          'the certificate. Any other device needs the new code.'
        : 'Connected devices reopen the page by themselves.',
  });
  useConsoleStore
    .getState()
    .append('log', [`Serving devices over ${name}.`, ...urlLines(status)].join('\n'));
}

/**
 * Turns live reload on or off, for every window: the setting is kept with the
 * device settings, per machine. Not in the table below: its argument is the
 * checkbox's value; the palette has `toggleLiveReload`.
 *
 * Turning it on lifts a pause: someone who turns it on again means it to run.
 */
export async function setLiveReload(on: boolean): Promise<void> {
  try {
    await window.studio.devices.saveSettings({ liveReload: on });
  } catch (cause) {
    showFailure('Could not change live reload', cause);
    return;
  }
  if (on) useDeviceStore.setState({ liveReloadRefused: null });
  useToastStore.getState().push(
    on
      ? {
          kind: 'info',
          title: 'Live reload on',
          description:
            'Devices relaunch a second after each change, from the window that launched them.',
        }
      : { kind: 'info', title: 'Live reload off' },
  );
}

/** What a toast calls the option a patch changed, as it is now. */
function launchOptionTitle(patch: Partial<DeviceLaunchOptions>): string {
  if (patch.forceWebGL !== undefined) {
    return patch.forceWebGL ? 'WebGL2 forced on devices' : 'WebGL2 no longer forced';
  }
  if (patch.maxPixelRatio !== undefined) {
    if (patch.maxPixelRatio !== null) return `Pixel ratio on devices: ${patch.maxPixelRatio}×`;
    const project = useProjectStore.getState().project?.settings.rendering.maxPixelRatio;
    return `Pixel ratio on devices: the project’s${project === undefined ? '' : ` (${project}×)`}`;
  }
  return patch.stats === true ? 'Stats shown on devices' : 'Stats hidden on devices';
}

/**
 * Changes what every device is launched with — one option at a time, the
 * others kept as the settings have them. Not in the table below: its argument
 * is a value a checkbox or the pixel-ratio picker produced; the palette has
 * the two toggles.
 *
 * An option the renderer reads restarts every connected device on the current
 * launch at once, in the main process; stats on screen reach each page with
 * no restart. The toast says which, and how many devices it touched.
 */
export async function setLaunchOptions(patch: Partial<DeviceLaunchOptions>): Promise<void> {
  let status: DeviceServerStatus;
  try {
    status = await window.studio.devices.saveSettings({ launchOptions: patch });
  } catch (cause) {
    showFailure('Could not change the launch options', cause);
    return;
  }
  const title = launchOptionTitle(patch);
  let description: string | undefined;
  if (!isRunning(status) || status.launch === null) {
    description = 'It takes effect at the next launch.';
  } else if (patch.forceWebGL !== undefined || patch.maxPixelRatio !== undefined) {
    const count = connectedDevices(status).length;
    description =
      count === 0
        ? 'Devices that open the link use it.'
        : `${count} ${count === 1 ? 'device restarts' : 'devices restart'} on it.`;
  } else if (patch.stats === true) {
    description = 'Each device draws its numbers in a corner, without restarting.';
  }
  useToastStore.getState().push({ kind: 'info', title, description });
}

/*
 * The device server's gestures. Choosing the port asks for its value itself,
 * as creating a scene asks for a name, so it is a gesture like the others.
 */
export const DEVICE_COMMANDS = {
  launchOnDevices: defineCommand({
    label: () => 'Launch on Devices',
    // What is launched is the open project's: the main process refuses
    // without one, and saying so here greys the entry instead.
    can: () => useProjectStore.getState().summary !== null,
    run: () => launchOnDevices(),
  }),
  stopDeviceServer: defineCommand({
    label: () => 'Stop Device Server',
    can: () => {
      const state = useDeviceStore.getState().status?.state;
      return state === 'running' || state === 'starting';
    },
    run: () => stopDeviceServer(),
  }),
  deviceServerPort: defineCommand({
    label: () => 'Device Server Port…',
    // The port is kept per machine, not per project, so it can be chosen
    // whether or not the server runs.
    can: () => true,
    run: () => chooseDevicePort(),
  }),
  reclaimDevicePort: defineCommand({
    label: () => `Take Back Port ${useDeviceStore.getState().status?.requestedPort ?? ''}`.trim(),
    can: () => hasSlid(useDeviceStore.getState().status),
    run: () => reclaimDevicePort(),
  }),
  copyDeviceLink: defineCommand({
    label: () => 'Copy Device Link',
    can: () => deviceLink(useDeviceStore.getState().status) !== null,
    run: () => copyDeviceLink(),
  }),
  openDevicePage: defineCommand({
    label: () => 'Open Device Page in Browser',
    can: () => localDeviceUrl(useDeviceStore.getState().status) !== null,
    run: () => openDevicePage(),
  }),
  newDeviceLink: defineCommand({
    label: () => 'New Device Link…',
    // The token is kept per machine, as the port is: a new one can be made
    // whether or not the server runs.
    can: () => true,
    run: () => newDeviceLink(),
  }),
  toggleLiveReload: defineCommand({
    // Names the action, as Hide and Show do.
    label: () =>
      useDeviceStore.getState().status?.liveReload === true
        ? 'Turn Off Live Reload on Devices'
        : 'Turn On Live Reload on Devices',
    // Whether it is on is the server's to say: until a status has been read,
    // the label could only guess.
    can: () => useDeviceStore.getState().status !== null,
    run: () => setLiveReload(useDeviceStore.getState().status?.liveReload !== true),
  }),
  toggleDeviceStats: defineCommand({
    label: () =>
      useDeviceStore.getState().status?.launchOptions.stats === true
        ? 'Hide Stats on Devices'
        : 'Show Stats on Devices',
    // The options are the server's to say, as live reload is.
    can: () => useDeviceStore.getState().status !== null,
    run: () =>
      setLaunchOptions({ stats: useDeviceStore.getState().status?.launchOptions.stats !== true }),
  }),
  toggleForceWebGL: defineCommand({
    label: () =>
      useDeviceStore.getState().status?.launchOptions.forceWebGL === true
        ? 'Stop Forcing WebGL2 on Devices'
        : 'Force WebGL2 on Devices',
    can: () => useDeviceStore.getState().status !== null,
    run: () =>
      setLaunchOptions({
        forceWebGL: useDeviceStore.getState().status?.launchOptions.forceWebGL !== true,
      }),
  }),
};
