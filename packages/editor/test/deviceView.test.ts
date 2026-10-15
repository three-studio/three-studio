import type { DeviceServerStatus } from '@three-studio/core';
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
    devices: [],
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

const ON_MAC = { platform: 'darwin', dev: false } as const;

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
    const [, firewall] = deviceView(status(), { platform: 'darwin', dev: true }).help.items;

    expect(firewall).toBe(
      'If macOS asked whether Electron may accept incoming connections and it was refused, ' +
        'allow it in System Settings › Network › Firewall › Options.',
    );
  });

  it('names Three Studio on Windows, and private networks', () => {
    const [, firewall] = deviceView(status(), { platform: 'win32', dev: false }).help.items;

    expect(firewall).toContain('Allow Three Studio in Windows Security');
    expect(firewall).toContain('private');
  });

  it('puts the port in the ufw command on Linux', () => {
    const [, firewall] = deviceView(status({ port: 7702 }), { platform: 'linux', dev: false }).help
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
