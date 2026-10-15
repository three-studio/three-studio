import {
  PROJECT_FORMAT_VERSION,
  createBuildProfiles,
  createPhysicsSettings,
  createRenderingSettings,
  createStarterScene,
  type DeviceServerStatus,
  type DevicesApi,
  type ProjectFile,
} from '@three-studio/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEVICE_COMMANDS,
  chooseDevicePort,
  launchOnDevices,
  reclaimDevicePort,
} from '../src/commands/deviceCommands';
import { useConsoleStore } from '../src/state/consoleStore';
import { useDeviceStore, watchDevices } from '../src/state/deviceStore';
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
    ...overrides,
  };
}

type Answers = Partial<Record<keyof DevicesApi, (...args: unknown[]) => Promise<DeviceServerStatus>>>;

interface Bridge {
  calls: { method: string; args: unknown[] }[];
  changed: ((status: DeviceServerStatus) => void) | null;
}

/** `window.studio`, with only what these gestures reach, answering as told. */
function install(answers: Answers, platform = 'darwin'): Bridge {
  const bridge: Bridge = { calls: [], changed: null };
  const call =
    (method: keyof DevicesApi) =>
    async (...args: unknown[]): Promise<DeviceServerStatus> => {
      bridge.calls.push({ method, args });
      const answer = answers[method];
      if (answer === undefined) throw new Error(`devices.${method} was not expected`);
      return answer(...args);
    };
  vi.stubGlobal('window', {
    studio: {
      platform,
      devices: {
        status: call('status'),
        start: call('start'),
        stop: call('stop'),
        launch: call('launch'),
        saveSettings: call('saveSettings'),
        reclaimPort: call('reclaimPort'),
        onChanged: (listener: (status: DeviceServerStatus) => void) => {
          bridge.changed = listener;
          return () => {
            bridge.changed = null;
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

const toasts = () => useToastStore.getState().toasts;
const lastToast = () => toasts().at(-1)!;
const lastEntry = () => useConsoleStore.getState().entries.at(-1)!;

beforeEach(() => {
  useToastStore.getState().clear();
  useConsoleStore.getState().clear();
  useDeviceStore.setState({ status: null });
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

  it('shows the link to type, and keeps every link in the Console', async () => {
    install({ launch: async () => status() });

    await launchOnDevices();

    expect(toasts()).toHaveLength(1);
    expect(lastToast()).toMatchObject({
      kind: 'success',
      title: 'Launched “Level” on devices',
      description: `http://192.168.1.42:7700/${TOKEN}/`,
    });
    const entry = lastEntry();
    expect(entry.level).toBe('log');
    expect(entry.text).toContain(`http://192.168.1.42:7700/${TOKEN}/`);
    expect(entry.text).toContain(`http://100.101.102.103:7700/${TOKEN}/`);
    expect(entry.text).toContain(`http://localhost:7700/${TOKEN}/`);
    expect(entry.text).toContain('Tailscale');
    expect(entry.text).toContain('Reload the page on each device to run this launch.');
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
    expect(lastToast().actions).toEqual([]);
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
