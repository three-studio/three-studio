import {
  PROJECT_FORMAT_VERSION,
  createBuildProfiles,
  createDeviceLaunchOptions,
  createPhysicsSettings,
  createRenderingSettings,
  createStarterScene,
  type DeviceInfo,
  type DeviceLogs,
  type DeviceServerStatus,
  type DevicesApi,
  type ProjectFile,
} from '@three-studio/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEVICE_COMMANDS,
  captureDevice,
  captureDevices,
  chooseDeviceAddress,
  chooseDevicePort,
  chooseDeviceTransport,
  copyDeviceLink,
  launchOnDevices,
  newDeviceLink,
  openDevicePage,
  reclaimDevicePort,
  relaunchOnDevices,
  restartDevice,
  setLaunchOptions,
  setLiveReload,
} from '../src/commands/deviceCommands';
import { useConsoleStore } from '../src/state/consoleStore';
import {
  appendDeviceLogs,
  liveReloadState,
  noteLaunch,
  noteReloads,
  refreshDevices,
  useDeviceStore,
  watchDevices,
} from '../src/state/deviceStore';
import { useDialogStore } from '../src/state/dialogStore';
import { useDocumentStore } from '../src/state/documentStore';
import { useProjectStore } from '../src/state/projectStore';
import { useToastStore } from '../src/state/toastStore';
import { launchSnapshot } from '../src/viewport/PlaySession';

/*
 * The device server's gestures, against a bridge written by hand: what each
 * sends to the main process, and what a person is told — in a toast, which
 * goes, and in the Console, which keeps the links.
 */

const TOKEN = 'abcdefghijKLMNOPQRST01';

function status(overrides: Partial<DeviceServerStatus> = {}): DeviceServerStatus {
  const port = overrides.port ?? 7700;
  return {
    state: 'running',
    transport: 'http',
    port,
    requestedPort: 7700,
    portHolder: null,
    urls: [
      { address: '192.168.1.42', label: 'en0', url: `http://192.168.1.42:${port}/${TOKEN}/` },
      { address: '100.101.102.103', label: 'Tailscale', url: `http://100.101.102.103:${port}/${TOKEN}/` },
      { address: 'localhost', label: 'This computer', url: `http://localhost:${port}/${TOKEN}/` },
    ],
    selectedUrl: `http://192.168.1.42:${port}/${TOKEN}/`,
    launch: { id: 'launch-1', at: 1, sceneName: 'Level' },
    reachedFromNetwork: false,
    address: null,
    liveReload: false,
    launchOptions: createDeviceLaunchOptions(),
    devices: [],
    certificate: null,
    ...overrides,
  };
}

type Answers = Partial<Record<keyof DevicesApi, (...args: unknown[]) => Promise<unknown>>>;

interface Bridge {
  calls: { method: string; args: unknown[] }[];
  changed: ((status: DeviceServerStatus) => void) | null;
  /** Who listens to the devices' lines, as `devices:log` would reach them. */
  logged: ((logs: DeviceLogs) => void) | null;
  /** What `window.open` was asked to open. */
  opened: unknown[][];
}

/** `window.studio`, with only what these gestures reach, answering as told. */
function install(answers: Answers, platform = 'darwin'): Bridge {
  const bridge: Bridge = { calls: [], changed: null, logged: null, opened: [] };
  const call =
    (method: keyof DevicesApi) =>
    async (...args: unknown[]): Promise<unknown> => {
      bridge.calls.push({ method, args });
      const answer = answers[method];
      if (answer === undefined) throw new Error(`devices.${method} was not expected`);
      return answer(...args);
    };
  vi.stubGlobal('window', {
    open: (...args: unknown[]) => void bridge.opened.push(args),
    studio: {
      platform,
      devices: {
        status: call('status'),
        start: call('start'),
        stop: call('stop'),
        launch: call('launch'),
        saveSettings: call('saveSettings'),
        reclaimPort: call('reclaimPort'),
        regenerateToken: call('regenerateToken'),
        restart: call('restart'),
        screenshot: call('screenshot'),
        revealScreenshot: call('revealScreenshot'),
        onChanged: (listener: (status: DeviceServerStatus) => void) => {
          bridge.changed = listener;
          return () => {
            bridge.changed = null;
          };
        },
        onLog: (listener: (logs: DeviceLogs) => void) => {
          bridge.logged = listener;
          return () => {
            bridge.logged = null;
          };
        },
      },
    },
  });
  return bridge;
}

const project: ProjectFile = {
  version: PROJECT_FORMAT_VERSION,
  name: 'Races',
  engineVersion: '0.1.0',
  startScene: 'scene-1',
  settings: {
    loadingScene: null,
    rendering: createRenderingSettings(),
    physics: createPhysicsSettings(),
    build: createBuildProfiles('Races'),
  },
};

function openProject(): void {
  useProjectStore.setState({
    summary: { name: 'Races', path: '/projects/Races', lastOpenedAt: 1 },
    project,
    sceneId: 'scene-1',
    scenes: [{ id: 'scene-1', name: 'Level', path: 'scenes/Level.scene.json', shadowedBy: null }],
  } as never);
}

function device(overrides: Partial<DeviceInfo> = {}): DeviceInfo {
  return {
    id: 'phone0000',
    name: 'iPhone',
    browser: 'Safari',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    address: '192.168.1.20',
    screen: { width: 393, height: 852, dpr: 3 },
    secureContext: false,
    launch: 'launch-1',
    state: 'booting',
    backend: null,
    error: null,
    connected: true,
    stats: null,
    reloads: 0,
    ...overrides,
  };
}

const toasts = () => useToastStore.getState().toasts;
const lastToast = () => toasts().at(-1)!;
const lastEntry = () => useConsoleStore.getState().entries.at(-1)!;

beforeEach(() => {
  useToastStore.getState().clear();
  useConsoleStore.getState().clear();
  useDeviceStore.setState({
    status: null,
    popoverOpen: false,
    ownLaunch: null,
    liveReloadRefused: null,
    notedReloads: null,
    capturing: [],
  });
  useDialogStore.getState().cancel();
  useDocumentStore.getState().replaceScene(createStarterScene());
  openProject();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Launch on Devices', () => {
  it('sends what Play would run, read the way a launch reads it', async () => {
    const bridge = install({ launch: async () => status() });

    await launchOnDevices();

    expect(bridge.calls.map((call) => call.method)).toEqual(['launch']);
    expect(bridge.calls[0]!.args[0]).toEqual(launchSnapshot());
  });

  it('keeps the launch it made, with the snapshot it sent, once it is current', async () => {
    const bridge = install({
      launch: async () => status({ launch: { id: 'launch-7', at: 7, sceneName: 'Level' } }),
    });

    await launchOnDevices();

    const own = useDeviceStore.getState().ownLaunch;
    expect(own?.id).toBe('launch-7');
    expect(own?.snapshot).toBe(bridge.calls[0]!.args[0]);
  });

  it('leaves nothing behind when a newer launch or a stop dropped it', async () => {
    // The newer launch reports for itself, and a stop was asked for.
    install({ launch: async () => null });

    await launchOnDevices();

    expect(toasts()).toEqual([]);
    expect(useConsoleStore.getState().entries).toEqual([]);
    expect(useDeviceStore.getState().ownLaunch).toBeNull();
  });

  it('shows the link to type, and keeps every link in the Console', async () => {
    install({ launch: async () => status() });

    await launchOnDevices();

    expect(toasts()).toHaveLength(1);
    expect(lastToast()).toMatchObject({
      kind: 'success',
      title: 'Launched “Level”',
      description: `http://192.168.1.42:7700/${TOKEN}/`,
    });
    const entry = lastEntry();
    expect(entry.level).toBe('log');
    expect(entry.text).toContain(`http://192.168.1.42:7700/${TOKEN}/`);
    expect(entry.text).toContain(`http://100.101.102.103:7700/${TOKEN}/`);
    expect(entry.text).toContain(`http://localhost:7700/${TOKEN}/`);
    expect(entry.text).toContain('Tailscale');
  });

  it('counts the devices it restarted, and the Console names them', async () => {
    install({
      launch: async () =>
        status({
          devices: [
            device({ id: 'phone0001', address: '192.168.1.20' }),
            device({ id: 'phone0002', name: 'Android', browser: 'Chrome', address: '192.168.1.21' }),
            device({ id: 'phone0003', name: 'iPad', connected: false }),
          ],
        }),
    });

    await launchOnDevices();

    expect(lastToast().title).toBe('Launched “Level” on 2 devices');
    const entry = lastEntry().text;
    expect(entry).toContain('iPhone · Safari (192.168.1.20)');
    expect(entry).toContain('Android · Chrome (192.168.1.21)');
    expect(entry).not.toContain('iPad');
  });

  it('says how a phone joins when none was there to restart', async () => {
    install({ launch: async () => status() });

    await launchOnDevices();

    const hint = 'Open the link on a phone: it restarts on every launch.';
    expect(lastToast().title).toBe('Launched “Level”');
    expect(lastToast().details).toContain(hint);
    expect(lastEntry().text).toContain(hint);
  });

  it('says a phone accepts the certificate once, under HTTPS', async () => {
    install({ launch: async () => status({ transport: 'https' }) });

    await launchOnDevices();

    const hint =
      'Open the link on a phone and accept its certificate once: it restarts on every launch.';
    expect(lastToast().details).toContain(hint);
    expect(lastEntry().text).toContain(hint);
  });

  it('no longer asks for each page to be reloaded', async () => {
    install({ launch: async () => status({ devices: [device()] }) });

    await launchOnDevices();

    expect(lastToast().details).not.toContain('Reload the page');
    expect(lastEntry().text).not.toContain('Reload the page');
  });

  it('warns about a port another Three Studio holds, and offers to quit it', async () => {
    const slid = status({
      port: 7701,
      portHolder: { pid: 4242, program: '/Applications/Three Studio.app/Contents/MacOS/Three Studio', sameApp: true },
    });
    const bridge = install({ launch: async () => slid, reclaimPort: async () => status() });
    useDeviceStore.setState({ status: slid });

    await launchOnDevices();

    const toast = lastToast();
    expect(toast.kind).toBe('warning');
    expect(toast.description).toBe(
      'Port 7700 is held by another Three Studio (process 4242), so devices are served on 7701.',
    );
    expect(toast.details).toContain(`http://192.168.1.42:7701/${TOKEN}/`);
    expect(lastEntry().level).toBe('warn');

    const quit = toast.actions!.find((action) => action.label === 'Quit the Other Three Studio')!;
    quit.onClick();
    await vi.waitFor(() => expect(lastToast().kind).toBe('success'));

    expect(bridge.calls.map((call) => call.method)).toEqual(['launch', 'reclaimPort']);
    // The same toast, become the launch's success at the kept port.
    expect(toasts()).toHaveLength(1);
    expect(lastToast().description).toBe(`http://192.168.1.42:7700/${TOKEN}/`);
  });

  it('names a holder it will not quit, and says in the Console how to find it', async () => {
    install({
      launch: async () =>
        status({ port: 7701, portHolder: { pid: 99, program: '/usr/local/bin/node', sameApp: false } }),
    });

    await launchOnDevices();

    expect(lastToast().kind).toBe('warning');
    expect(lastToast().description).toContain('node (process 99)');
    // Nothing offers to quit it: the only action is the code.
    expect(lastToast().actions?.map((action) => action.label)).toEqual(['Show QR Code']);
    expect(lastEntry().text).toContain('lsof -nP -iTCP:7700 -sTCP:LISTEN');
  });

  it('gives the Windows command on Windows', async () => {
    install({ launch: async () => status({ port: 7701 }) }, 'win32');

    await launchOnDevices();

    expect(lastToast().description).toContain('another program');
    expect(lastEntry().text).toContain('netstat -ano | findstr :7700');
  });

  it('warns when only this computer can reach the server', async () => {
    install({
      launch: async () =>
        status({
          urls: [{ address: 'localhost', label: 'This computer', url: `http://localhost:7700/${TOKEN}/` }],
          selectedUrl: `http://localhost:7700/${TOKEN}/`,
        }),
    });

    await launchOnDevices();

    expect(lastToast().kind).toBe('warning');
    expect(lastToast().description).toBe('No network address — only this computer can reach it.');
    expect(lastToast().details).toContain(`http://localhost:7700/${TOKEN}/`);
  });

  it('says why it was refused, without the wrapper IPC puts around it', async () => {
    install({
      launch: async () => {
        throw new Error(
          "Error invoking remote method 'devices:launch': Error: Scripts did not compile:\nSpin.ts:1:28: Expected \"}\"",
        );
      },
    });

    await launchOnDevices();

    expect(toasts()).toHaveLength(1);
    expect(lastToast()).toMatchObject({
      kind: 'error',
      title: 'Could not launch on devices',
      description: 'Scripts did not compile:',
    });
    expect(lastToast().details).toBe('Scripts did not compile:\nSpin.ts:1:28: Expected "}"');
    expect(lastEntry().level).toBe('error');
    expect(lastEntry().text).toContain('Spin.ts:1:28');
    expect(lastEntry().text).not.toContain('Error invoking remote method');
  });
});

describe('relaunching, for live reload', () => {
  /** A launch made current, its id counted, and every device listed told of it. */
  function current(id: number, devices: DeviceInfo[]): DeviceServerStatus {
    return status({ liveReload: true, launch: { id: `launch-${id}`, at: id, sceneName: 'Level' }, devices });
  }

  const PHONES = [
    device({ id: 'phone0001' }),
    device({ id: 'phone0002', name: 'Android', browser: 'Chrome', address: '192.168.1.21' }),
  ];

  const REFUSAL =
    "Error invoking remote method 'devices:launch': Error: Scripts did not compile:\nShout.ts:3:1: Expected \";\"";

  it('says so in one Console line, which the next relaunch folds into, and in no toast', async () => {
    let launches = 1;
    install({ launch: async () => current((launches += 1), PHONES) });

    await relaunchOnDevices(launchSnapshot());

    expect(toasts()).toEqual([]);
    expect(lastEntry()).toMatchObject({
      level: 'log',
      text: 'Relaunched “Level” on 2 devices',
      count: 1,
    });

    const second = launchSnapshot();
    await relaunchOnDevices(second);

    expect(useConsoleStore.getState().entries).toHaveLength(1);
    expect(lastEntry().count).toBe(2);
    expect(useDeviceStore.getState().ownLaunch?.id).toBe('launch-3');
    expect(useDeviceStore.getState().ownLaunch?.snapshot).toBe(second);
  });

  it('names no count when no device was there to restart', async () => {
    install({ launch: async () => current(2, []) });

    await relaunchOnDevices(launchSnapshot());

    expect(lastEntry().text).toBe('Relaunched “Level”');
  });

  it('says nothing, and keeps the launch it had, when a newer launch or a stop dropped it', async () => {
    const mine = { id: 'launch-1', snapshot: launchSnapshot() };
    useDeviceStore.setState({ ownLaunch: mine });
    install({ launch: async () => null });

    await relaunchOnDevices(launchSnapshot());

    expect(toasts()).toEqual([]);
    expect(useConsoleStore.getState().entries).toEqual([]);
    expect(useDeviceStore.getState().ownLaunch).toBe(mine);
  });

  it('pauses on a refusal, said once, until a launch from this window succeeds', async () => {
    let refuse = true;
    install({
      launch: async () => {
        if (refuse) throw new Error(REFUSAL);
        return current(2, PHONES);
      },
    });
    useDeviceStore.setState({
      status: current(1, PHONES),
      ownLaunch: { id: 'launch-1', snapshot: launchSnapshot() },
    });

    await relaunchOnDevices(launchSnapshot());

    expect(toasts()).toHaveLength(1);
    expect(lastToast()).toMatchObject({
      kind: 'error',
      title: 'Live reload paused',
      description: 'Scripts did not compile:',
    });
    expect(lastToast().details).toBe('Scripts did not compile:\nShout.ts:3:1: Expected ";"');
    expect(lastToast().actions?.map((action) => action.label)).toEqual(['Launch']);
    expect(lastEntry()).toMatchObject({
      level: 'error',
      text: 'Live reload paused — the launch was refused: Scripts did not compile:\nShout.ts:3:1: Expected ";"',
    });
    const paused = useDeviceStore.getState();
    expect(paused.liveReloadRefused).toBe('Scripts did not compile:\nShout.ts:3:1: Expected ";"');
    expect(liveReloadState(paused.status, paused.ownLaunch, paused.liveReloadRefused)).toBe('paused');

    refuse = false;
    lastToast().actions![0]!.onClick();

    await vi.waitFor(() => expect(useDeviceStore.getState().ownLaunch?.id).toBe('launch-2'));
    expect(useDeviceStore.getState().liveReloadRefused).toBeNull();
  });
});

describe('the Console, one launch at a time', () => {
  const IPHONE_LOGS = {
    device: 'phone0000',
    name: 'iPhone',
    browser: 'Safari',
    lines: [{ level: 'log' as const, text: 'Shout loaded', count: 1 }],
    dropped: 0,
  };
  const launched = (id: string) => status({ launch: { id, at: 1, sceneName: 'Level' } });
  const texts = () => useConsoleStore.getState().entries.map((entry) => entry.text);

  it('keeps a device’s lines while its launch is current, and lets them go with the next', () => {
    noteLaunch(launched('launch-note-1'));
    useConsoleStore.getState().append('log', 'editor line');
    appendDeviceLogs(IPHONE_LOGS);

    noteLaunch(launched('launch-note-1'));
    expect(texts()).toEqual(['editor line', 'Shout loaded']);

    noteLaunch(launched('launch-note-2'));
    expect(texts()).toEqual(['editor line']);
  });

  it('keeps them through a status with no launch', () => {
    noteLaunch(launched('launch-note-3'));
    appendDeviceLogs(IPHONE_LOGS);

    noteLaunch(status({ state: 'stopped', launch: null }));

    expect(texts()).toEqual(['Shout loaded']);
  });

  it('lets them go before this window’s relaunch says so, which folds into the line before', async () => {
    let launches = 100;
    install({
      launch: async () =>
        status({
          liveReload: true,
          launch: { id: `launch-${(launches += 1)}`, at: launches, sceneName: 'Level' },
          devices: [device()],
        }),
    });

    await relaunchOnDevices(launchSnapshot());
    appendDeviceLogs(IPHONE_LOGS);
    expect(texts()).toEqual(['Relaunched “Level” on 1 device', 'Shout loaded']);

    await relaunchOnDevices(launchSnapshot());

    expect(useConsoleStore.getState().entries.map(({ text, count }) => [text, count])).toEqual([
      ['Relaunched “Level” on 1 device', 2],
    ]);
  });

  it('follows the server, whichever window launched', async () => {
    const bridge = install({ status: async () => launched('launch-note-5') });
    watchDevices();
    await vi.waitFor(() => expect(useDeviceStore.getState().status).not.toBeNull());
    bridge.logged!(IPHONE_LOGS);

    bridge.changed!(launched('launch-note-5'));
    expect(texts()).toEqual(['Shout loaded']);

    bridge.changed!(launched('launch-note-6'));
    expect(texts()).toEqual([]);
  });
});

describe('turning live reload on and off', () => {
  it('writes the setting, says so, and lifts a pause', async () => {
    const bridge = install({ saveSettings: async () => status({ liveReload: true }) });
    useDeviceStore.setState({ liveReloadRefused: 'Scripts did not compile:' });

    await setLiveReload(true);

    expect(bridge.calls).toEqual([{ method: 'saveSettings', args: [{ liveReload: true }] }]);
    expect(lastToast()).toMatchObject({
      kind: 'info',
      title: 'Live reload on',
      description: 'Devices relaunch a second after each change, from the window that launched them.',
    });
    expect(useDeviceStore.getState().liveReloadRefused).toBeNull();
  });

  it('turns it off, which leaves a pause where it was', async () => {
    const bridge = install({ saveSettings: async () => status({ liveReload: false }) });
    useDeviceStore.setState({ liveReloadRefused: 'Scripts did not compile:' });

    await setLiveReload(false);

    expect(bridge.calls).toEqual([{ method: 'saveSettings', args: [{ liveReload: false }] }]);
    expect(lastToast()).toMatchObject({ kind: 'info', title: 'Live reload off' });
    expect(useDeviceStore.getState().liveReloadRefused).toBe('Scripts did not compile:');
  });

  it('says why it could not, without the wrapper IPC puts around it', async () => {
    install({
      saveSettings: async () => {
        throw new Error("Error invoking remote method 'devices:saveSettings': Error: EACCES: permission denied");
      },
    });

    await setLiveReload(true);

    expect(lastToast()).toMatchObject({
      kind: 'error',
      title: 'Could not change live reload',
      description: 'EACCES: permission denied',
    });
    expect(lastEntry().level).toBe('error');
  });

  it('is a command whose label says what it would do, once the server has been read', () => {
    const toggle = DEVICE_COMMANDS.toggleLiveReload;

    expect(toggle.can()).toBe(false);

    useDeviceStore.setState({ status: status({ liveReload: false }) });
    expect(toggle.can()).toBe(true);
    expect(toggle.label()).toBe('Turn On Live Reload on Devices');

    useDeviceStore.setState({ status: status({ liveReload: true }) });
    expect(toggle.label()).toBe('Turn Off Live Reload on Devices');
  });

  it('runs as the command turns it the other way', async () => {
    const bridge = install({ saveSettings: async () => status({ liveReload: false }) });
    useDeviceStore.setState({ status: status({ liveReload: true }) });

    await DEVICE_COMMANDS.toggleLiveReload.run();

    expect(bridge.calls).toEqual([{ method: 'saveSettings', args: [{ liveReload: false }] }]);
  });
});

describe('the launch options', () => {
  const forcing = { ...createDeviceLaunchOptions(), forceWebGL: true };
  const TWO_PHONES = [device(), device({ id: 'phone0001', name: 'Android', browser: 'Chrome' })];

  it('write the one option changed, and count the devices that restart on it', async () => {
    const bridge = install({
      saveSettings: async () => status({ launchOptions: forcing, devices: TWO_PHONES }),
    });

    await setLaunchOptions({ forceWebGL: true });

    expect(bridge.calls).toEqual([
      { method: 'saveSettings', args: [{ launchOptions: { forceWebGL: true } }] },
    ]);
    expect(lastToast()).toMatchObject({
      kind: 'info',
      title: 'WebGL2 forced on devices',
      description: '2 devices restart on it.',
    });
  });

  it('leave it to the devices that open the link when none is connected', async () => {
    install({
      saveSettings: async () =>
        status({ launchOptions: createDeviceLaunchOptions(), devices: [device({ connected: false })] }),
    });

    await setLaunchOptions({ forceWebGL: false });

    expect(lastToast()).toMatchObject({
      title: 'WebGL2 no longer forced',
      description: 'Devices that open the link use it.',
    });
  });

  it('take effect at the next launch while stopped, or before anything is launched', async () => {
    install({ saveSettings: async () => status({ state: 'stopped', launch: null, launchOptions: forcing }) });
    await setLaunchOptions({ forceWebGL: true });
    expect(lastToast()).toMatchObject({
      title: 'WebGL2 forced on devices',
      description: 'It takes effect at the next launch.',
    });

    install({ saveSettings: async () => status({ launch: null, launchOptions: forcing }) });
    await setLaunchOptions({ stats: true });
    expect(lastToast()).toMatchObject({
      title: 'Stats shown on devices',
      description: 'It takes effect at the next launch.',
    });
  });

  it('say the pixel ratio, the project’s included', async () => {
    install({ saveSettings: async () => status({ devices: TWO_PHONES }) });

    await setLaunchOptions({ maxPixelRatio: 1 });
    expect(lastToast().title).toBe('Pixel ratio on devices: 1×');

    await setLaunchOptions({ maxPixelRatio: null });
    expect(lastToast().title).toBe('Pixel ratio on devices: the project’s (2×)');
  });

  it('say stats are drawn or no longer, and that nothing restarts', async () => {
    install({ saveSettings: async () => status({ devices: TWO_PHONES }) });

    await setLaunchOptions({ stats: true });
    expect(lastToast()).toMatchObject({
      title: 'Stats shown on devices',
      description: 'Each device draws its numbers in a corner, without restarting.',
    });

    await setLaunchOptions({ stats: false });
    expect(lastToast()).toMatchObject({ title: 'Stats hidden on devices', description: undefined });
  });

  it('say why they could not be changed, without the wrapper IPC puts around it', async () => {
    install({
      saveSettings: async () => {
        throw new Error("Error invoking remote method 'devices:saveSettings': Error: EACCES: permission denied");
      },
    });

    await setLaunchOptions({ stats: true });

    expect(lastToast()).toMatchObject({
      kind: 'error',
      title: 'Could not change the launch options',
      description: 'EACCES: permission denied',
    });
  });

  it('are two commands whose labels say what they would do, once the server has been read', () => {
    const stats = DEVICE_COMMANDS.toggleDeviceStats;
    const webgl = DEVICE_COMMANDS.toggleForceWebGL;

    expect(stats.can()).toBe(false);
    expect(webgl.can()).toBe(false);

    useDeviceStore.setState({ status: status() });
    expect([stats.can(), webgl.can()]).toEqual([true, true]);
    expect([stats.label(), webgl.label()]).toEqual(['Show Stats on Devices', 'Force WebGL2 on Devices']);

    useDeviceStore.setState({ status: status({ launchOptions: { ...forcing, stats: true } }) });
    expect([stats.label(), webgl.label()]).toEqual([
      'Hide Stats on Devices',
      'Stop Forcing WebGL2 on Devices',
    ]);
  });

  it('run as the commands turn them the other way', async () => {
    const bridge = install({ saveSettings: async () => status() });
    useDeviceStore.setState({ status: status({ launchOptions: { ...forcing, stats: true } }) });

    await DEVICE_COMMANDS.toggleDeviceStats.run();
    await DEVICE_COMMANDS.toggleForceWebGL.run();

    expect(bridge.calls.map((call) => call.args)).toEqual([
      [{ launchOptions: { stats: false } }],
      [{ launchOptions: { forceWebGL: false } }],
    ]);
  });
});

describe('a reload nobody asked for, in the Console', () => {
  const SAID =
    'iPhone · Safari: the page ended without warning and was reloaded — it most likely ran out of memory.';

  it('is said once as this window’s own line when a device’s count grows, never at the first reading', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      // A reload before the window opened is the row's to show.
      noteReloads(status({ devices: [device({ reloads: 1 })] }));
      expect(warn).not.toHaveBeenCalled();

      noteReloads(status({ devices: [device({ reloads: 2 })] }));
      expect(warn.mock.calls).toEqual([[SAID]]);

      const android = device({ id: 'phone0001', name: 'Android', browser: 'Chrome', reloads: 1 });
      noteReloads(status({ devices: [device({ reloads: 2 }), android] }));
      noteReloads(status({ devices: [device({ reloads: 2 }), android] }));
      expect(warn.mock.calls.map(([text]) => String(text).split(':')[0])).toEqual([
        'iPhone · Safari',
        'Android · Chrome',
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  it('is noted from every status the window hears', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const bridge = install({ status: async () => status({ devices: [device()] }) });
      watchDevices();
      await vi.waitFor(() => expect(useDeviceStore.getState().status).not.toBeNull());

      bridge.changed!(status({ devices: [device({ reloads: 1 })] }));

      expect(warn.mock.calls).toEqual([[SAID]]);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('what live reload is doing in this window', () => {
  const own = (id: string) => ({ id, snapshot: launchSnapshot() });

  it('is off while the setting is, or before the server has been read', () => {
    expect(liveReloadState(status({ liveReload: false }), own('launch-1'), null)).toBe('off');
    expect(liveReloadState(null, own('launch-1'), null)).toBe('off');
  });

  it('is idle while the server is stopped, or runs with nothing launched', () => {
    expect(
      liveReloadState(status({ liveReload: true, state: 'stopped', launch: null }), null, null),
    ).toBe('idle');
    expect(liveReloadState(status({ liveReload: true, launch: null }), own('launch-1'), null)).toBe(
      'idle',
    );
  });

  it('is elsewhere while the devices run another window’s launch', () => {
    expect(liveReloadState(status({ liveReload: true }), own('launch-9'), null)).toBe('elsewhere');
    expect(liveReloadState(status({ liveReload: true }), null, null)).toBe('elsewhere');
  });

  it('is paused by a refusal, and on otherwise', () => {
    expect(liveReloadState(status({ liveReload: true }), own('launch-1'), 'Scripts did not compile')).toBe(
      'paused',
    );
    expect(liveReloadState(status({ liveReload: true }), own('launch-1'), null)).toBe('on');
  });
});

describe('restarting one device', () => {
  it('asks the main process to restart that device, and says nothing when it does', async () => {
    const bridge = install({ restart: async () => status({ devices: [device({ state: 'booting' })] }) });

    await restartDevice('abc12345');

    expect(bridge.calls).toEqual([{ method: 'restart', args: ['abc12345'] }]);
    expect(toasts()).toEqual([]);
  });

  it('says why it was refused, without the wrapper IPC puts around it', async () => {
    install({
      restart: async () => {
        throw new Error(
          "Error invoking remote method 'devices:restart': Error: That device is not connected.",
        );
      },
    });

    await restartDevice('abc12345');

    expect(lastToast()).toMatchObject({
      kind: 'error',
      title: 'Could not restart the device',
      description: 'That device is not connected.',
    });
    expect(lastEntry().level).toBe('error');
  });
});

describe('a screenshot on one device', () => {
  const shot = {
    path: '/projects/Races/Screenshots/Level — iPhone · Safari — 2026-10-01 at 14.32.05.png',
    width: 786,
    height: 1704,
    bytes: 2_100_000,
  };

  beforeEach(() => {
    useDeviceStore.setState({
      status: status({ devices: [device({ id: 'abc12345', state: 'running', backend: 'webgl' })] }),
    });
  });

  it('asks the main process for that device’s frame, and marks the device meanwhile', async () => {
    let meanwhile: readonly string[] = [];
    const bridge = install({
      screenshot: async () => {
        meanwhile = useDeviceStore.getState().capturing;
        return shot;
      },
    });

    await captureDevice('abc12345');

    expect(bridge.calls).toEqual([{ method: 'screenshot', args: ['abc12345'] }]);
    expect(meanwhile).toEqual(['abc12345']);
    expect(useDeviceStore.getState().capturing).toEqual([]);
  });

  it('waits in one toast, for the frame and then for where to save it', async () => {
    let answer: (value: unknown) => void = () => undefined;
    install({ screenshot: () => new Promise((resolve) => (answer = resolve)) });

    const taking = captureDevice('abc12345');
    expect(toasts()).toHaveLength(1);
    expect(lastToast()).toMatchObject({
      kind: 'progress',
      title: 'Screenshot from iPhone · Safari',
      description: 'Waiting for its frame, then for where to save it…',
    });

    answer(shot);
    await taking;
    expect(toasts()).toHaveLength(1);
  });

  it('says where it was saved and how large it is, and shows it in the Finder', async () => {
    const bridge = install({ screenshot: async () => shot, revealScreenshot: async () => undefined });

    await captureDevice('abc12345');

    expect(lastToast()).toMatchObject({
      kind: 'success',
      title: 'Screenshot saved',
      description: '786×1704 · 2.1 MB',
      details: shot.path,
    });
    expect(lastToast().actions).toMatchObject([{ label: 'Show in Finder', primary: true }]);
    lastToast().actions![0]!.onClick();
    expect(bridge.calls.at(-1)).toEqual({ method: 'revealScreenshot', args: [shot.path] });
    expect(lastEntry()).toMatchObject({
      level: 'log',
      text: `Screenshot from iPhone · Safari, 786×1704: ${shot.path}`,
    });
  });

  it('leaves nothing behind when the person cancels the dialog', async () => {
    install({ screenshot: async () => null });

    await captureDevice('abc12345');

    expect(toasts()).toEqual([]);
    expect(useConsoleStore.getState().entries).toEqual([]);
    expect(useDeviceStore.getState().capturing).toEqual([]);
  });

  it('says why no frame came, without the wrapper IPC puts around it', async () => {
    install({
      screenshot: async () => {
        throw new Error(
          "Error invoking remote method 'devices:screenshot': Error: No frame came back from " +
            'iPhone · Safari within 10 s. Is the game in front on the device?',
        );
      },
    });

    await captureDevice('abc12345');

    expect(toasts()).toHaveLength(1);
    expect(lastToast()).toMatchObject({
      kind: 'error',
      title: 'No screenshot from iPhone · Safari',
      description:
        'No frame came back from iPhone · Safari within 10 s. Is the game in front on the device?',
    });
    expect(lastEntry().level).toBe('error');
    expect(useDeviceStore.getState().capturing).toEqual([]);
  });
});

describe('Take Screenshots on Devices', () => {
  const shot = { path: '/shots/a.png', width: 3, height: 2, bytes: 70 };
  const devices = [
    device({ id: 'aaaa0000', state: 'running', backend: 'webgl' }),
    device({ id: 'bbbb0000', state: 'running', backend: 'webgpu', name: 'Android', browser: 'Chrome' }),
    device({ id: 'cccc0000', state: 'running', backend: 'webgl', connected: false }),
  ];

  it('asks every device that can give a frame, all at once', async () => {
    useDeviceStore.setState({ status: status({ devices }) });
    const answers: ((value: unknown) => void)[] = [];
    const bridge = install({ screenshot: () => new Promise((resolve) => answers.push(resolve)) });

    const taking = captureDevices();
    expect(bridge.calls).toEqual([
      { method: 'screenshot', args: ['aaaa0000'] },
      { method: 'screenshot', args: ['bbbb0000'] },
    ]);

    for (const answer of answers) answer(shot);
    await taking;
  });

  it('does not ask again a device this window is already taking one of', async () => {
    useDeviceStore.setState({ status: status({ devices }), capturing: ['aaaa0000'] });
    const bridge = install({ screenshot: async () => shot });

    await captureDevices();

    expect(bridge.calls).toEqual([{ method: 'screenshot', args: ['bbbb0000'] }]);
  });

  it('is offered once a status has been read, while a device can give a frame', () => {
    expect(DEVICE_COMMANDS.captureDevices.can()).toBe(false);
    useDeviceStore.setState({ status: status({ devices: [devices[2]!] }) });
    expect(DEVICE_COMMANDS.captureDevices.can()).toBe(false);
    useDeviceStore.setState({ status: status({ devices }) });
    expect(DEVICE_COMMANDS.captureDevices.can()).toBe(true);
    expect(DEVICE_COMMANDS.captureDevices.label()).toBe('Take Screenshots on Devices');
  });
});

describe('Device Server Port…', () => {
  it('refuses what cannot be listened on, and saves a port that can', async () => {
    useDeviceStore.setState({ status: status() });
    const bridge = install({ saveSettings: async () => status({ port: 7800, requestedPort: 7800 }) });

    const choosing = chooseDevicePort();
    await vi.waitFor(() => expect(useDialogStore.getState().prompt).not.toBeNull());
    const prompt = useDialogStore.getState().prompt!;

    expect(prompt.defaultValue).toBe('7700');
    expect(prompt.validate!('80')).not.toBeNull();
    expect(prompt.validate!('abc')).not.toBeNull();
    expect(prompt.validate!('70000')).not.toBeNull();
    expect(prompt.validate!('7800')).toBeNull();
    useDialogStore.getState().submit('7800');
    await choosing;

    expect(bridge.calls).toEqual([{ method: 'saveSettings', args: [{ port: 7800 }] }]);
    expect(lastToast().description).toBe(`http://192.168.1.42:7800/${TOKEN}/`);
  });
});

describe('Take Back Port', () => {
  it('says nothing when the person declines', async () => {
    const slid = status({ port: 7701, portHolder: { pid: 4242, program: null, sameApp: true } });
    useDeviceStore.setState({ status: slid });
    install({ reclaimPort: async () => slid });

    await reclaimDevicePort();

    expect(toasts()).toEqual([]);
  });

  it('says why not when the main process refuses', async () => {
    useDeviceStore.setState({ status: status({ port: 7701 }) });
    install({
      reclaimPort: async () => {
        throw new Error(
          "Error invoking remote method 'devices:reclaimPort': Error: Port 7700 is still in use.",
        );
      },
    });

    await reclaimDevicePort();

    expect(lastToast()).toMatchObject({
      kind: 'error',
      title: 'Could not take back port 7700',
      description: 'Port 7700 is still in use.',
    });
  });
});

describe('what each gesture can do', () => {
  it('launches only with a project open', () => {
    expect(DEVICE_COMMANDS.launchOnDevices.can()).toBe(true);
    useProjectStore.setState({ summary: null } as never);
    expect(DEVICE_COMMANDS.launchOnDevices.can()).toBe(false);
  });

  it('stops only a server that runs, or is starting', () => {
    expect(DEVICE_COMMANDS.stopDeviceServer.can()).toBe(false);
    useDeviceStore.setState({ status: status({ state: 'stopped', urls: [], selectedUrl: null }) });
    expect(DEVICE_COMMANDS.stopDeviceServer.can()).toBe(false);
    useDeviceStore.setState({ status: status({ state: 'starting', urls: [], selectedUrl: null }) });
    expect(DEVICE_COMMANDS.stopDeviceServer.can()).toBe(true);
    useDeviceStore.setState({ status: status() });
    expect(DEVICE_COMMANDS.stopDeviceServer.can()).toBe(true);
  });

  it('takes back only a port the server slid away from, and names it', () => {
    useDeviceStore.setState({ status: status() });
    expect(DEVICE_COMMANDS.reclaimDevicePort.can()).toBe(false);
    useDeviceStore.setState({ status: status({ port: 7701 }) });
    expect(DEVICE_COMMANDS.reclaimDevicePort.can()).toBe(true);
    expect(DEVICE_COMMANDS.reclaimDevicePort.label()).toBe('Take Back Port 7700');
  });

  it('lets the port be chosen whether or not the server runs', () => {
    expect(DEVICE_COMMANDS.deviceServerPort.can()).toBe(true);
  });
});

describe('following the server', () => {
  it('keeps a change that arrived while the first reading was on its way', async () => {
    let answer: (status: DeviceServerStatus) => void = () => undefined;
    const bridge = install({
      status: () => new Promise<DeviceServerStatus>((resolve) => (answer = resolve)),
    });

    const stop = watchDevices();
    bridge.changed!(status({ state: 'running' }));
    answer(status({ state: 'stopped', urls: [], selectedUrl: null }));
    await Promise.resolve();
    await Promise.resolve();

    expect(useDeviceStore.getState().status?.state).toBe('running');
    stop();
    expect(bridge.changed).toBeNull();
  });

  it('takes the first reading when nothing changed before it', async () => {
    install({ status: async () => status({ state: 'stopped', urls: [], selectedUrl: null }) });

    watchDevices();

    await vi.waitFor(() => expect(useDeviceStore.getState().status?.state).toBe('stopped'));
  });
});

describe('a device’s lines', () => {
  const IPHONE = { device: 'phone0000', name: 'iPhone', browser: 'Safari' };
  const read = () =>
    useConsoleStore.getState().entries.map(({ level, text, count, source }) => ({
      level,
      text,
      count,
      from: source?.label ?? null,
    }));

  it('reach the Console under the device’s label, and never through the console', () => {
    const bridge = install({ status: async () => status() });
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    watchDevices();

    bridge.logged!({
      ...IPHONE,
      lines: [
        { level: 'log', text: 'Shout loaded', count: 1 },
        { level: 'warn', text: 'careful', count: 1 },
        { level: 'error', text: 'Uncaught Error: late boom (scripts.mjs:57:13)', count: 2 },
      ],
      dropped: 0,
    });

    expect(read()).toEqual([
      { level: 'log', text: 'Shout loaded', count: 1, from: 'iPhone · Safari' },
      { level: 'warn', text: 'careful', count: 1, from: 'iPhone · Safari' },
      {
        level: 'error',
        text: 'Uncaught Error: late boom (scripts.mjs:57:13)',
        count: 2,
        from: 'iPhone · Safari',
      },
    ]);
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });

  it('say once how many were dropped on the way', () => {
    const bridge = install({ status: async () => status() });
    watchDevices();

    bridge.logged!({ ...IPHONE, lines: [], dropped: 120 });
    bridge.logged!({ ...IPHONE, lines: [{ level: 'log', text: 'after', count: 1 }], dropped: 1 });

    expect(read()).toEqual([
      {
        level: 'warn',
        text: '120 lines from this device were dropped before reaching the editor: it logged more than the link carries.',
        count: 1,
        from: 'iPhone · Safari',
      },
      { level: 'log', text: 'after', count: 1, from: 'iPhone · Safari' },
      {
        level: 'warn',
        text: '1 line from this device was dropped before reaching the editor: it logged more than the link carries.',
        count: 1,
        from: 'iPhone · Safari',
      },
    ]);
  });

  it('stop being heard when the window stops following the server', () => {
    const bridge = install({ status: async () => status() });
    const stop = watchDevices();

    stop();

    expect(bridge.changed).toBeNull();
    expect(bridge.logged).toBeNull();
  });
});

const LOCAL_ONLY = {
  urls: [{ address: 'localhost', label: 'This computer', url: `http://localhost:7700/${TOKEN}/` }],
  selectedUrl: `http://localhost:7700/${TOKEN}/`,
};

/** `navigator.clipboard`, keeping what was written, or refusing as an unfocused window does. */
function clipboard(refuse = false): string[] {
  const written: string[] = [];
  vi.stubGlobal('navigator', {
    clipboard: {
      writeText: async (text: string) => {
        if (refuse) throw new DOMException('Document is not focused.', 'NotAllowedError');
        written.push(text);
      },
    },
  });
  return written;
}

describe('Copy Device Link', () => {
  it('copies the link a phone opens, and shows it', async () => {
    useDeviceStore.setState({ status: status() });
    install({});
    const written = clipboard();

    await copyDeviceLink();

    expect(written).toEqual([`http://192.168.1.42:7700/${TOKEN}/`]);
    expect(lastToast()).toMatchObject({
      kind: 'info',
      description: `http://192.168.1.42:7700/${TOKEN}/`,
    });
  });

  it('cannot run while the server is stopped, nor while only this computer can reach it', () => {
    useDeviceStore.setState({ status: status({ state: 'stopped', urls: [], selectedUrl: null }) });
    expect(DEVICE_COMMANDS.copyDeviceLink.can()).toBe(false);
    useDeviceStore.setState({ status: status(LOCAL_ONLY) });
    expect(DEVICE_COMMANDS.copyDeviceLink.can()).toBe(false);
    useDeviceStore.setState({ status: status() });
    expect(DEVICE_COMMANDS.copyDeviceLink.can()).toBe(true);
  });

  it('says so when the clipboard refuses', async () => {
    useDeviceStore.setState({ status: status() });
    install({});
    clipboard(true);

    await copyDeviceLink();

    expect(lastToast()).toMatchObject({
      kind: 'error',
      title: 'Could not copy the device link',
      description: 'Document is not focused.',
    });
  });
});

describe('Open Device Page in Browser', () => {
  it('opens this computer’s link, not the network’s', () => {
    useDeviceStore.setState({ status: status() });
    const bridge = install({});

    openDevicePage();

    // `localhost` is a secure context to the browser, where a LAN address is not.
    expect(bridge.opened).toEqual([[`http://localhost:7700/${TOKEN}/`, '_blank', 'noopener']]);
  });

  it('can run while the server runs, network or not', () => {
    expect(DEVICE_COMMANDS.openDevicePage.can()).toBe(false);
    useDeviceStore.setState({ status: status({ state: 'stopped', urls: [], selectedUrl: null }) });
    expect(DEVICE_COMMANDS.openDevicePage.can()).toBe(false);
    useDeviceStore.setState({ status: status(LOCAL_ONLY) });
    expect(DEVICE_COMMANDS.openDevicePage.can()).toBe(true);
  });
});

describe('New Device Link…', () => {
  const FRESH = 'ZYXWVUTSRQPONMLKJIHGFE';

  async function answer(accept: boolean): Promise<void> {
    await vi.waitFor(() => expect(useDialogStore.getState().confirm).not.toBeNull());
    if (accept) useDialogStore.getState().accept();
    else useDialogStore.getState().cancel();
  }

  it('asks first, and does nothing when declined', async () => {
    const bridge = install({ regenerateToken: async () => status() });

    const making = newDeviceLink();
    await vi.waitFor(() => expect(useDialogStore.getState().confirm).not.toBeNull());
    expect(useDialogStore.getState().confirm).toMatchObject({
      title: 'Make a new device link?',
      message:
        'The current link stops working at once. Every device that saved it — a bookmark, ' +
        'a home-screen icon — needs the new one.',
      confirmLabel: 'Make New Link',
      destructive: true,
    });
    await answer(false);
    await making;

    expect(bridge.calls).toEqual([]);
    expect(toasts()).toEqual([]);
  });

  it('makes one when accepted, and shows it', async () => {
    const renewed = status({
      urls: status().urls.map((url) => ({ ...url, url: url.url.replace(TOKEN, FRESH) })),
      selectedUrl: `http://192.168.1.42:7700/${FRESH}/`,
    });
    const bridge = install({ regenerateToken: async () => renewed });

    const making = newDeviceLink();
    await answer(true);
    await making;

    expect(bridge.calls.map((call) => call.method)).toEqual(['regenerateToken']);
    expect(lastToast()).toMatchObject({
      kind: 'info',
      description: `http://192.168.1.42:7700/${FRESH}/`,
    });
    expect(lastEntry().text).toContain(`http://localhost:7700/${FRESH}/`);
  });

  it('says when it takes effect, while the server is stopped', async () => {
    install({
      regenerateToken: async () => status({ state: 'stopped', urls: [], selectedUrl: null }),
    });

    const making = newDeviceLink();
    await answer(true);
    await making;

    expect(lastToast()).toMatchObject({
      kind: 'info',
      description: 'It takes effect when the server starts.',
    });
  });

  it('says why it was refused', async () => {
    install({
      regenerateToken: async () => {
        throw new Error("Error invoking remote method 'devices:regenerateToken': Error: EACCES");
      },
    });

    const making = newDeviceLink();
    await answer(true);
    await making;

    expect(lastToast()).toMatchObject({ kind: 'error', description: 'EACCES' });
  });

  it('can always run', () => {
    expect(DEVICE_COMMANDS.newDeviceLink.can()).toBe(true);
  });
});

describe('choosing the address', () => {
  it('saves the address picked, or gives the choice back to the server', async () => {
    const bridge = install({ saveSettings: async () => status() });

    await chooseDeviceAddress('100.101.102.103');
    await chooseDeviceAddress(null);

    expect(bridge.calls).toEqual([
      { method: 'saveSettings', args: [{ address: '100.101.102.103' }] },
      { method: 'saveSettings', args: [{ address: null }] },
    ]);
  });

  it('says why it was refused', async () => {
    install({
      saveSettings: async () => {
        throw new Error("Error invoking remote method 'devices:saveSettings': Error: EACCES");
      },
    });

    await chooseDeviceAddress('100.101.102.103');

    expect(lastToast()).toMatchObject({ kind: 'error', description: 'EACCES' });
  });
});

describe('choosing the protocol', () => {
  /** The links of a server that went over to HTTPS. */
  const secure = (): DeviceServerStatus => {
    const running = status({ transport: 'https' });
    const urls = running.urls.map((url) => ({ ...url, url: url.url.replace('http:', 'https:') }));
    return { ...running, urls, selectedUrl: urls[0]!.url };
  };

  it('saves HTTPS, and says connected devices follow while others need the new code', async () => {
    const bridge = install({ saveSettings: async () => secure() });

    await chooseDeviceTransport('https');

    expect(bridge.calls).toEqual([{ method: 'saveSettings', args: [{ transport: 'https' }] }]);
    expect(lastToast()).toMatchObject({
      kind: 'info',
      title: 'Serving devices over HTTPS',
      description:
        'Connected devices reopen the page by themselves, and each one asks once to accept ' +
        'the certificate. Any other device needs the new code.',
    });
    // Every link changed its scheme: the Console keeps the new ones.
    expect(lastEntry().text).toContain(`https://192.168.1.42:7700/${TOKEN}/`);
  });

  it('says connected devices follow back to HTTP', async () => {
    install({ saveSettings: async () => status() });

    await chooseDeviceTransport('http');

    expect(lastToast()).toMatchObject({
      kind: 'info',
      title: 'Serving devices over HTTP',
      description: 'Connected devices reopen the page by themselves.',
    });
  });

  it('says when it takes effect, while the server is stopped', async () => {
    install({
      saveSettings: async () =>
        status({ state: 'stopped', transport: 'https', urls: [], selectedUrl: null }),
    });

    await chooseDeviceTransport('https');

    expect(lastToast()).toMatchObject({
      kind: 'info',
      title: 'Devices will be served over HTTPS',
      description: 'It takes effect when the server starts.',
    });
  });

  it('says why it was refused, without the wrapper IPC puts around it', async () => {
    install({
      saveSettings: async () => {
        throw new Error(
          "Error invoking remote method 'devices:saveSettings': " +
            'Error: Could not make the HTTPS certificate: EACCES',
        );
      },
    });

    await chooseDeviceTransport('https');

    expect(lastToast()).toMatchObject({
      kind: 'error',
      title: 'Could not change the protocol',
      description: 'Could not make the HTTPS certificate: EACCES',
    });
  });
});

describe('the code, from the launch toast', () => {
  const labels = () => (lastToast().actions ?? []).map((action) => action.label);

  it('is offered with a link a phone can open, and opens the popover', async () => {
    install({ launch: async () => status() });

    await launchOnDevices();

    expect(labels()).toEqual(['Show QR Code']);
    lastToast().actions![0]!.onClick();
    expect(useDeviceStore.getState().popoverOpen).toBe(true);
  });

  it('is not offered when only this computer can open the page', async () => {
    install({ launch: async () => status(LOCAL_ONLY) });

    await launchOnDevices();

    expect(labels()).toEqual([]);
  });

  it('sits beside quitting the other Three Studio, after a slide', async () => {
    install({
      launch: async () =>
        status({ port: 7701, portHolder: { pid: 4242, program: null, sameApp: true } }),
    });

    await launchOnDevices();

    expect(labels()).toEqual(['Quit the Other Three Studio', 'Show QR Code']);
  });
});

describe('reading the server again', () => {
  it('keeps a change that arrived while the reading was on its way', async () => {
    let answer: (status: DeviceServerStatus) => void = () => undefined;
    const bridge = install({
      status: () => new Promise<DeviceServerStatus>((resolve) => (answer = resolve)),
    });
    const stop = watchDevices();
    answer(status({ state: 'stopped', urls: [], selectedUrl: null }));
    await vi.waitFor(() => expect(useDeviceStore.getState().status?.state).toBe('stopped'));

    const refreshing = refreshDevices();
    bridge.changed!(status({ state: 'running' }));
    answer(status({ state: 'stopped', urls: [], selectedUrl: null }));
    await refreshing;

    expect(useDeviceStore.getState().status?.state).toBe('running');
    stop();
  });

  it('takes the reading when nothing changed meanwhile', async () => {
    useDeviceStore.setState({ status: status({ state: 'stopped', urls: [], selectedUrl: null }) });
    install({ status: async () => status({ address: '100.101.102.103' }) });

    await refreshDevices();

    expect(useDeviceStore.getState().status?.address).toBe('100.101.102.103');
  });
});
