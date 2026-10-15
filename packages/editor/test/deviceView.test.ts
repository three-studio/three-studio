import {
  createDeviceLaunchOptions,
  type DeviceInfo,
  type DeviceServerStatus,
  type DeviceStats,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { deviceView } from '../src/shell/deviceView';
import { deviceLink, localDeviceUrl } from '../src/state/deviceStore';

/*
 * What the device button and its popover say, from the status alone: every
 * state the server can be in, without a DOM.
 */

const TOKEN = 'abcdefghijKLMNOPQRST01';

const EN0 = `http://192.168.1.42:7700/${TOKEN}/`;
const TAILSCALE = `http://100.101.102.103:7700/${TOKEN}/`;
const LOCAL = `http://localhost:7700/${TOKEN}/`;

const URLS = [
  { address: '192.168.1.42', label: 'en0', url: EN0 },
  { address: '100.101.102.103', label: 'Tailscale', url: TAILSCALE },
  { address: 'localhost', label: 'This computer', url: LOCAL },
];

function status(overrides: Partial<DeviceServerStatus> = {}): DeviceServerStatus {
  return {
    state: 'running',
    transport: 'http',
    port: 7700,
    requestedPort: 7700,
    portHolder: null,
    urls: URLS,
    selectedUrl: EN0,
    launch: { id: 'launch-1', at: 1, sceneName: 'Level 1' },
    reachedFromNetwork: false,
    address: null,
    liveReload: false,
    launchOptions: createDeviceLaunchOptions(),
    devices: [],
    certificate: null,
    ...overrides,
  };
}

const STOPPED = status({
  state: 'stopped',
  port: 7705,
  requestedPort: 7705,
  urls: [],
  selectedUrl: null,
  launch: null,
});

const ON_MAC = {
  platform: 'darwin',
  dev: false,
  ownLaunch: null,
  liveReloadRefused: null,
  projectRendering: { forceWebGL: false, maxPixelRatio: 2 },
} as const;

describe('a server that is stopped', () => {
  it('shows the settings’ port, no link and no dot', () => {
    const view = deviceView(STOPPED, ON_MAC);

    expect(view.dot).toBe('none');
    expect(view.stateLabel).toBe('Stopped');
    expect(view.port).toBe(7705);
    expect(view.link).toBeNull();
    expect(view.localUrl).toBeNull();
    expect(view.sceneName).toBeNull();
    expect(view.title).toBe('Launch on Devices');
  });

  it('is what a window shows before its first reading', () => {
    expect(deviceView(null, ON_MAC).dot).toBe('none');
    expect(deviceView(null, ON_MAC).link).toBeNull();
  });
});

describe('a server that is starting', () => {
  it('pulses', () => {
    const view = deviceView(status({ state: 'starting', urls: [], selectedUrl: null }), ON_MAC);

    expect(view.dot).toBe('starting');
  });
});

describe('a server that runs on the Wi-Fi, Tailscale and this computer', () => {
  const view = deviceView(status(), ON_MAC);

  it('gives phones the Wi-Fi’s link, and this computer its own', () => {
    expect(view.dot).toBe('running');
    expect(view.stateLabel).toBe('Running');
    expect(view.sceneName).toBe('Level 1');
    expect(view.link).toBe(EN0);
    expect(view.localUrl).toBe(LOCAL);
    expect(view.noNetwork).toBe(false);
    expect(view.title).toContain(EN0);
  });

  it('offers automatic, then each address with what it is on, and never localhost', () => {
    // A phone cannot open `localhost`: it is this computer's, and the popover
    // opens it here with a button of its own.
    expect(view.addresses).toEqual([
      { value: '', label: 'Automatic' },
      { value: '192.168.1.42', label: '192.168.1.42 — en0' },
      { value: '100.101.102.103', label: '100.101.102.103 — Tailscale' },
    ]);
    expect(view.address).toBe('');
    expect(view.addressNote).toBeNull();
  });

  it('says devices see the waiting page before the first launch', () => {
    expect(deviceView(status({ launch: null }), ON_MAC).sceneName).toBeNull();
  });
});

describe('a chosen address', () => {
  it('is the select’s value, and Tailscale’s says what a phone needs', () => {
    const view = deviceView(
      status({ address: '100.101.102.103', selectedUrl: TAILSCALE }),
      ON_MAC,
    );

    expect(view.address).toBe('100.101.102.103');
    expect(view.link).toBe(TAILSCALE);
    expect(view.addressNote).toBe(
      'Phones need Tailscale on, in the same tailnet — on Wi-Fi or mobile data.',
    );
  });

  it('is offered as not connected while it is gone, and the note names the one shown instead', () => {
    const view = deviceView(status({ address: '10.0.0.7' }), ON_MAC);

    expect(view.address).toBe('10.0.0.7');
    expect(view.addresses.at(-1)).toEqual({ value: '10.0.0.7', label: '10.0.0.7 — not connected' });
    expect(view.addressNote).toBe(
      '10.0.0.7 is not connected. The code shows 192.168.1.42 meanwhile.',
    );
  });
});

describe('a server only this computer can reach', () => {
  it('has no link for a phone, and says so', () => {
    const local = [URLS[2]!];
    const view = deviceView(status({ urls: local, selectedUrl: LOCAL }), ON_MAC);

    expect(view.link).toBeNull();
    expect(view.noNetwork).toBe(true);
    expect(view.localUrl).toBe(LOCAL);
    expect(view.addresses).toEqual([{ value: '', label: 'Automatic' }]);
  });
});

describe('a port that slid', () => {
  const slid = (portHolder: DeviceServerStatus['portHolder']): DeviceServerStatus =>
    status({
      port: 7701,
      requestedPort: 7700,
      portHolder,
      urls: URLS.map((url) => ({ ...url, url: url.url.replace(':7700/', ':7701/') })),
      selectedUrl: EN0.replace(':7700/', ':7701/'),
    });

  it('names another Three Studio, and offers to take the port back', () => {
    const view = deviceView(slid({ pid: 4242, program: '/Applications/Three Studio.app', sameApp: true }), ON_MAC);

    expect(view.dot).toBe('slid');
    expect(view.port).toBe(7701);
    expect(view.requestedPort).toBe(7700);
    expect(view.note).toBe('7700 is held by another Three Studio (process 4242).');
    expect(view.takeBack).toBe(true);
    expect(view.title).toContain('7700');
  });

  it('names another program by its file', () => {
    const view = deviceView(slid({ pid: 99, program: '/usr/local/bin/node', sameApp: false }), ON_MAC);

    expect(view.note).toBe('7700 is held by node (process 99).');
    // Taking the port back also moves to one that came free since.
    expect(view.takeBack).toBe(true);
  });

  it('says so when nothing could be named', () => {
    expect(deviceView(slid(null), ON_MAC).note).toBe('7700 is in use by another program.');
  });

  it('says nothing while the server runs where it was asked to', () => {
    const view = deviceView(status(), ON_MAC);

    expect(view.note).toBeNull();
    expect(view.takeBack).toBe(false);
  });
});

describe('a server that could not start', () => {
  it('shows why, and the red dot', () => {
    const error = 'The web player has not been built. Run npm run build:web.';
    const view = deviceView(
      status({ state: 'error', error, urls: [], selectedUrl: null, launch: null }),
      ON_MAC,
    );

    expect(view.dot).toBe('error');
    expect(view.error).toBe(error);
    expect(view.title).toContain(error);
  });
});

describe('the help for a phone that cannot connect', () => {
  it('names Electron on macOS in development, which is what the firewall asks about', () => {
    const [, firewall] = deviceView(status(), { ...ON_MAC, dev: true }).help.items;

    expect(firewall).toBe(
      'If macOS asked whether Electron may accept incoming connections and it was refused, ' +
        'allow it in System Settings › Network › Firewall › Options.',
    );
  });

  it('names Three Studio on Windows, and private networks', () => {
    const [, firewall] = deviceView(status(), { ...ON_MAC, platform: 'win32' }).help.items;

    expect(firewall).toContain('Allow Three Studio in Windows Security');
    expect(firewall).toContain('private');
  });

  it('puts the port in the ufw command on Linux', () => {
    const [, firewall] = deviceView(status({ port: 7702 }), { ...ON_MAC, platform: 'linux' }).help
      .items;

    expect(firewall).toContain('sudo ufw allow 7702/tcp');
  });

  it('starts from what the server knows about the network', () => {
    expect(deviceView(status(), ON_MAC).help.lead).toMatch(/^Nothing on the network has reached/);
    expect(deviceView(status({ reachedFromNetwork: true }), ON_MAC).help.lead).toMatch(
      /^A device on the network has reached this computer/,
    );
    expect(deviceView(STOPPED, ON_MAC).help.lead).toBe('If a phone cannot open the link:');
  });

  it('always covers the same network, the firewall and isolated Wi-Fi', () => {
    const { items } = deviceView(STOPPED, ON_MAC).help;

    expect(items).toHaveLength(3);
    expect(items[0]).toMatch(/same Wi-Fi/);
    expect(items[2]).toMatch(/hotspot/);
  });
});

describe('the links a window reads from the status', () => {
  it('give a phone the selected link, never this computer’s', () => {
    expect(deviceLink(status())).toBe(EN0);
    expect(deviceLink(status({ urls: [URLS[2]!], selectedUrl: LOCAL }))).toBeNull();
    expect(deviceLink(STOPPED)).toBeNull();
    expect(deviceLink(null)).toBeNull();
  });

  it('give this computer localhost, while the server runs', () => {
    expect(localDeviceUrl(status())).toBe(LOCAL);
    expect(localDeviceUrl(STOPPED)).toBeNull();
    expect(localDeviceUrl(null)).toBeNull();
  });
});

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

function device(overrides: Partial<DeviceInfo> = {}): DeviceInfo {
  return {
    id: 'phone0000000001',
    name: 'iPhone',
    browser: 'Safari',
    userAgent: IPHONE_UA,
    address: '192.168.1.20',
    screen: { width: 393, height: 852, dpr: 3 },
    secureContext: false,
    launch: 'launch-1',
    state: 'running',
    backend: 'webgl',
    error: null,
    connected: true,
    stats: null,
    reloads: 0,
    ...overrides,
  };
}

describe('the devices', () => {
  it('names a phone, what it draws with, why not WebGPU, and its screen', () => {
    const [row] = deviceView(status({ devices: [device()] }), ON_MAC).devices;

    expect(row).toMatchObject({
      id: 'phone0000000001',
      label: 'iPhone · Safari',
      backend: 'WebGL2',
      state: 'WebGL2',
      tone: 'running',
      insecure: true,
      screen: '393×852 @3x',
      canRestart: true,
      error: null,
    });
    expect(row!.tooltip).toBe(`Connected from 192.168.1.20\n${IPHONE_UA}`);
  });

  it('marks nothing for a page in a secure context', () => {
    const mac = device({
      name: 'Mac',
      browser: 'Chrome',
      address: '::1',
      secureContext: true,
      backend: 'webgpu',
      screen: { width: 1512, height: 982, dpr: 2 },
    });

    const [row] = deviceView(status({ devices: [mac] }), ON_MAC).devices;

    expect(row).toMatchObject({
      backend: 'WebGPU',
      insecure: false,
      noWebGpu: false,
      screen: '1512×982 @2x',
    });
  });

  it('says why a secure page still draws with WebGL2', () => {
    // Safari before iOS 26, or a phone whose GPU Chrome does not take: the
    // page is secure, and the browser still gives it no WebGPU.
    const view = deviceView(status({ devices: [device({ secureContext: true })] }), ON_MAC);

    expect(view.devices[0]).toMatchObject({ backend: 'WebGL2', insecure: false, noWebGpu: true });
    expect(view.noWebGpuNote).toBe(
      'A secure page, and still WebGL2: this browser gave the page no WebGPU.',
    );
  });

  it('writes a pixel ratio to two decimals at most', () => {
    const [row] = deviceView(
      status({ devices: [device({ screen: { width: 412, height: 915, dpr: 2.625 } })] }),
      ON_MAC,
    ).devices;

    expect(row!.screen).toBe('412×915 @2.63x');
  });

  it('says what each page is doing, and Offline for one with no stream', () => {
    const rows = deviceView(
      status({
        devices: [
          device({ id: 'a0000000', state: 'waiting', launch: null, backend: null }),
          device({ id: 'b0000000', state: 'booting', backend: null }),
          device({ id: 'c0000000', state: 'running' }),
          device({ id: 'd0000000', state: 'failed', error: 'WebGL2 is not available.' }),
          device({ id: 'e0000000', state: 'running', connected: false }),
        ],
      }),
      ON_MAC,
    ).devices;

    expect(rows.map((row) => [row.state, row.tone])).toEqual([
      ['Waiting', 'running'],
      ['Starting…', 'starting'],
      ['WebGL2', 'running'],
      ['Failed', 'error'],
      ['Offline', 'none'],
    ]);
    expect(rows.map((row) => row.backend)).toEqual([null, null, 'WebGL2', null, null]);
    expect(rows[3]!.error).toBe('WebGL2 is not available.');
  });

  it('restarts only a connected device, and only once something is launched', () => {
    expect(deviceView(status({ devices: [device({ connected: false })] }), ON_MAC).devices[0]!
      .canRestart).toBe(false);
    expect(deviceView(status({ devices: [device()], launch: null }), ON_MAC).devices[0]!
      .canRestart).toBe(false);
  });

  it('counts the connected devices, and the tooltip says how many', () => {
    const view = deviceView(
      status({
        devices: [
          device({ id: 'a0000000' }),
          device({ id: 'b0000000' }),
          device({ id: 'c0000000', connected: false }),
        ],
      }),
      ON_MAC,
    );

    expect(view.count).toBe(2);
    expect(view.title.split('\n')[0]).toBe('Launch on Devices — 2 devices');
    expect(deviceView(status({ devices: [device()] }), ON_MAC).title.split('\n')[0]).toBe(
      'Launch on Devices — 1 device',
    );
    expect(deviceView(status(), ON_MAC).title.split('\n')[0]).toBe('Launch on Devices');
  });

  it('says how to get a first one', () => {
    const view = deviceView(status(), ON_MAC);

    expect(view.devices).toEqual([]);
    expect(view.count).toBe(0);
    expect(view.devicesNote).toBe(
      'No device yet. Open the link on a phone: it restarts on every launch.',
    );
    expect(deviceView(status({ devices: [device()] }), ON_MAC).devicesNote).toBeNull();
    expect(deviceView(STOPPED, ON_MAC).devicesNote).toBeNull();
  });

  it('explains the warning mark, and points to HTTPS under HTTP', () => {
    expect(deviceView(status(), ON_MAC).insecureNote).toBe(
      'Not a secure context, so no WebGPU: browsers allow it only over HTTPS or on localhost. ' +
        'Choose HTTPS under Protocol.',
    );
    expect(deviceView(overHttps(), ON_MAC).insecureNote).toBe(
      'Not a secure context, so no WebGPU: browsers allow it only over HTTPS or on localhost.',
    );
  });
});

const FINGERPRINT =
  'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89';

/** A server running over HTTPS, whose certificate nobody has refused. */
function overHttps(overrides: Partial<DeviceServerStatus> = {}): DeviceServerStatus {
  const secure = (url: string): string => url.replace('http://', 'https://');
  return status({
    transport: 'https',
    urls: URLS.map((url) => ({ ...url, url: secure(url.url) })),
    selectedUrl: secure(EN0),
    certificate: { fingerprint: FINGERPRINT, renewed: false, refusedBy: [] },
    ...overrides,
  });
}

describe('a device’s numbers', () => {
  const STATS: DeviceStats = {
    fps: 58,
    p95: 21,
    frames: 116,
    drawCalls: 142,
    triangles: 85_210,
    textures: 31,
    gpuMemory: 180 * 1024 * 1024,
    pixelRatio: 3,
    width: 1179,
    height: 2556,
    pinned30: false,
  };

  it('read on one line under its row, and every one of them in its title', () => {
    const [row] = deviceView(status({ devices: [device({ stats: STATS })] }), ON_MAC).devices;

    expect(row).toMatchObject({
      stats: '58 fps · p95 21 ms · 142 draws · 85.2k tris',
      measuring: false,
      warnings: [],
    });
    expect(row!.statsTitle).toBe(
      '58 fps · p95 21 ms\n142 draws · 85.2k tris · 31 textures · 180 MB\ndrawn at 3× · 1179×2556',
    );
  });

  it('are being measured on a page that runs the current launch, and on no other', () => {
    const rows = deviceView(
      status({
        devices: [
          device({ id: 'a0000000' }),
          device({ id: 'b0000000', connected: false }),
          device({ id: 'c0000000', state: 'booting', backend: null }),
          device({ id: 'd0000000', launch: 'launch-0' }),
        ],
      }),
      ON_MAC,
    ).devices;

    expect(rows.map((row) => row.measuring)).toEqual([true, false, false, false]);
    expect(rows.map((row) => row.stats)).toEqual([null, null, null, null]);
  });

  it('warn of Low Power Mode on an iPhone held at 30 fps, of a power-saving mode elsewhere', () => {
    const held: DeviceStats = { ...STATS, fps: 30, pinned30: true };

    const rows = deviceView(
      status({
        devices: [
          device({ id: 'a0000000', stats: held }),
          device({ id: 'b0000000', name: 'iPad', stats: held }),
          device({ id: 'c0000000', name: 'Android', browser: 'Chrome', stats: held }),
        ],
      }),
      ON_MAC,
    ).devices;

    expect(rows.map((row) => row.warnings)).toEqual([
      ['Held at 30 fps: Low Power Mode is probably on — Settings › Battery.'],
      ['Held at 30 fps: Low Power Mode is probably on — Settings › Battery.'],
      ['Held at 30 fps: a power-saving mode is probably on.'],
    ]);
  });

  it('warn that a page ended without warning and was reloaded, counted from the second time', () => {
    const rows = deviceView(
      status({
        devices: [
          device({ id: 'a0000000', reloads: 0 }),
          device({ id: 'b0000000', reloads: 1 }),
          // The count is the device's: it stays said while the device is offline.
          device({ id: 'c0000000', reloads: 2, connected: false }),
        ],
      }),
      ON_MAC,
    ).devices;

    expect(rows.map((row) => row.warnings)).toEqual([
      [],
      ['The page ended without warning and was reloaded: it most likely ran out of memory.'],
      ['The page ended without warning and was reloaded: it most likely ran out of memory. (2×)'],
    ]);
  });
});

describe('WebGL2, forced', () => {
  const forcing = { ...createDeviceLaunchOptions(), forceWebGL: true };

  it('is said when the launch options force it, and a secure page then lacks nothing', () => {
    const [row] = deviceView(
      status({ launchOptions: forcing, devices: [device({ secureContext: true })] }),
      ON_MAC,
    ).devices;

    expect(row).toMatchObject({
      backend: 'WebGL2 (forced)',
      state: 'WebGL2 (forced)',
      forced: 'options',
      backendTitle: 'Forced by the launch options.',
      insecure: false,
      noWebGpu: false,
    });
  });

  it('leaves a page under plain HTTP unmarked: WebGPU was not what it lacked', () => {
    const [row] = deviceView(status({ launchOptions: forcing, devices: [device()] }), ON_MAC).devices;

    expect(row).toMatchObject({ forced: 'options', insecure: false, noWebGpu: false });
  });

  it('is said when the project forces it', () => {
    const [row] = deviceView(status({ devices: [device({ secureContext: true })] }), {
      ...ON_MAC,
      projectRendering: { forceWebGL: true, maxPixelRatio: 2 },
    }).devices;

    expect(row).toMatchObject({
      backend: 'WebGL2 (forced)',
      forced: 'project',
      backendTitle: 'Forced by the project’s settings.',
      noWebGpu: false,
    });
  });

  it('is never said of a page on WebGPU, nor when nothing forces it', () => {
    const rows = deviceView(
      status({
        devices: [
          device({ id: 'a0000000', secureContext: true, backend: 'webgpu' }),
          device({ id: 'b0000000', secureContext: true }),
          device({ id: 'c0000000' }),
        ],
      }),
      { ...ON_MAC, projectRendering: null },
    ).devices;

    expect(rows.map((row) => [row.backend, row.forced, row.insecure, row.noWebGpu])).toEqual([
      ['WebGPU', null, false, false],
      ['WebGL2', null, false, true],
      ['WebGL2', null, true, false],
    ]);
    // A page still on WebGPU while the option arrives: its restart is on its way.
    const onWebGpu = device({ secureContext: true, backend: 'webgpu' });
    expect(
      deviceView(status({ launchOptions: forcing, devices: [onWebGpu] }), ON_MAC).devices[0]!.forced,
    ).toBeNull();
  });
});

/** A phone that accepted the certificate, and runs. */
const accepted = (): DeviceInfo => device({ secureContext: true, backend: 'webgpu' });

describe('live reload', () => {
  /** This window's launch, current in `status()`. */
  const MINE = { ...ON_MAC, ownLaunch: { id: 'launch-1' } };

  it('says nothing while it is off, and the checkbox what it would do', () => {
    const { liveReload } = deviceView(status(), MINE);

    expect(liveReload).toEqual({
      on: false,
      note: null,
      tone: 'hint',
      title: 'Relaunch every device a second after each change.',
    });
  });

  it('waits for a launch from this window while there is none to follow', () => {
    expect(deviceView({ ...STOPPED, liveReload: true }, MINE).liveReload).toMatchObject({
      on: true,
      note: 'Starts with the next Launch from this window.',
      tone: 'hint',
    });
    expect(deviceView(status({ liveReload: true, launch: null }), MINE).liveReload.note).toBe(
      'Starts with the next Launch from this window.',
    );
  });

  it('names the scene another window launched, and how to follow this one', () => {
    const view = deviceView(
      status({ liveReload: true, launch: { id: 'launch-9', at: 9, sceneName: 'Boss' } }),
      MINE,
    );

    expect(view.liveReload.note).toBe(
      '“Boss” was launched from another window. Launch here to follow this one.',
    );
    expect(view.liveReload.tone).toBe('hint');
  });

  it('warns that a refusal holds it', () => {
    const view = deviceView(status({ liveReload: true }), {
      ...MINE,
      liveReloadRefused: 'Scripts did not compile:',
    });

    expect(view.liveReload).toMatchObject({
      on: true,
      note: 'Paused: the last relaunch was refused. Launch to try again.',
      tone: 'warning',
    });
  });

  it('says what it does while it relaunches', () => {
    expect(deviceView(status({ liveReload: true }), MINE).liveReload).toMatchObject({
      on: true,
      note: 'Devices relaunch a second after each change — never mid-drag, never during Play.',
      tone: 'hint',
    });
  });

  it('is named on the button’s first line while it is on, and not while it is off', () => {
    const first = (view: { title: string }) => view.title.split('\n')[0];

    expect(first(deviceView(status({ liveReload: true, devices: [device()] }), MINE))).toBe(
      'Launch on Devices — 1 device — live reload',
    );
    expect(deviceView({ ...STOPPED, liveReload: true }, MINE).title).toBe(
      'Launch on Devices — live reload',
    );
    expect(first(deviceView(status({ devices: [device()] }), MINE))).toBe(
      'Launch on Devices — 1 device',
    );
    expect(deviceView(STOPPED, MINE).title).toBe('Launch on Devices');
  });
});

describe('the protocol', () => {
  it('is HTTP, which says what phones run on, with nothing to accept', () => {
    const view = deviceView(status(), ON_MAC);

    expect(view.transport).toBe('http');
    expect(view.transportNote).toBe(
      'Phones run WebGL2: browsers give WebGPU only to pages served over HTTPS.',
    );
    expect(view.certificate).toBeNull();
    expect(view.waiting).toEqual([]);
  });

  it('is HTTPS, which says what it gives and what it asks', () => {
    const view = deviceView(overHttps(), ON_MAC);

    expect(view.transport).toBe('https');
    expect(view.transportNote).toBe(
      'Phones get WebGPU. Each one asks once to trust this computer’s certificate.',
    );
  });

  it('is the settings’ while the server is stopped', () => {
    expect(deviceView({ ...STOPPED, transport: 'https' }, ON_MAC).transport).toBe('https');
    expect(deviceView(null, ON_MAC).transport).toBe('http');
  });
});

describe('accepting the certificate', () => {
  it('walks a phone through the warning, in each browser’s words, for the link’s host', () => {
    const { certificate } = deviceView(overHttps(), ON_MAC);

    expect(certificate?.lead).toBe(
      'Each phone first warns that the connection is not private: this computer signed its own ' +
        'certificate, and no authority vouches for it. Accept it once:',
    );
    expect(certificate?.steps).toEqual([
      'iPhone, Safari: Show Details › visit this website › Visit Website.',
      'Android, Chrome: Advanced › Proceed to 192.168.1.42 (unsafe).',
      'Other browsers: the same warning, then Advanced, and continue.',
      'This computer’s browser asks too, the first time Open in Browser uses HTTPS.',
    ]);
    expect(certificate?.lifetime).toBe(
      'Chrome asks again after a week. Every phone asks again when this computer makes a new ' +
        'certificate: on a network it has not served from before, and about once a year.',
    );
    expect(certificate?.renewedNote).toBeNull();
  });

  it('gives the fingerprint to check, whole and by its first four groups', () => {
    const { certificate } = deviceView(overHttps(), ON_MAC);

    expect(certificate?.fingerprint).toBe(FINGERPRINT);
    expect(certificate?.fingerprintStart).toBe('AB:CD:EF:01');
    expect(certificate?.check).toBe(
      'On a network you do not trust, view the certificate on the phone before accepting: ' +
        'its SHA-256 fingerprint starts with AB:CD:EF:01.',
    );
  });

  it('opens while no device is connected, and stays shut once one runs with nobody waiting', () => {
    expect(deviceView(overHttps(), ON_MAC).certificate?.open).toBe(true);
    expect(deviceView(overHttps({ devices: [accepted()] }), ON_MAC).certificate?.open).toBe(false);
  });

  it('lists addresses held at the warning, this computer’s browser by name, and opens', () => {
    const view = deviceView(
      overHttps({
        devices: [accepted()],
        certificate: {
          fingerprint: FINGERPRINT,
          renewed: false,
          refusedBy: ['192.168.1.50', '127.0.0.1'],
        },
      }),
      ON_MAC,
    );

    expect(view.waiting).toEqual([
      { address: '192.168.1.50', label: '192.168.1.50 has not accepted the certificate yet.' },
      {
        address: '127.0.0.1',
        label: 'This computer’s browser has not accepted the certificate yet.',
      },
    ]);
    expect(view.certificate?.open).toBe(true);
  });

  it('says phones ask again after a new certificate, and opens', () => {
    const view = deviceView(
      overHttps({
        devices: [accepted()],
        certificate: { fingerprint: FINGERPRINT, renewed: true, refusedBy: [] },
      }),
      ON_MAC,
    );

    expect(view.certificate?.renewedNote).toBe(
      'This computer made a new certificate as the server started: phones that had accepted ' +
        'the old one ask again.',
    );
    expect(view.certificate?.open).toBe(true);
  });

  it('gives the steps before the server runs, with no fingerprint to check yet', () => {
    const view = deviceView({ ...STOPPED, transport: 'https' }, ON_MAC);

    expect(view.certificate).toMatchObject({
      fingerprint: null,
      fingerprintStart: null,
      check: null,
      open: false,
    });
    expect(view.certificate?.steps[1]).toBe(
      'Android, Chrome: Advanced › Proceed to this computer’s address (unsafe).',
    );
    expect(
      deviceView({ ...STOPPED, transport: 'https', address: '10.0.0.7' }, ON_MAC).certificate
        ?.steps[1],
    ).toBe('Android, Chrome: Advanced › Proceed to 10.0.0.7 (unsafe).');
  });
});
