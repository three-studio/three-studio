import type { DeviceLogs } from '@three-studio/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceLink, type DeviceStream } from '../src/main/devices/deviceLink';

/*
 * The server's side of the link with each device, without HTTP: a stream is
 * anything that can be written to and ended, and a message is the body a
 * device posted. Every device here is a phone that will never be picked up.
 */

const L1 = 'L1aunch0000a';
const L2 = 'L2aunch0000b';
const TOKEN = 'tokentokentokentokento';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

interface RecordedStream extends DeviceStream {
  written: string[];
  ended: boolean;
}

function recorded(): RecordedStream {
  const stream: RecordedStream = {
    written: [],
    ended: false,
    write: (text) => {
      stream.written.push(text);
    },
    end: () => {
      stream.ended = true;
    },
  };
  return stream;
}

/**
 * What a stream was sent once open, as messages: the `data:` lines, parsed,
 * after the two every stream starts with — `retry`, then the options its page
 * draws by.
 */
function messages(stream: RecordedStream): Record<string, unknown>[] {
  return stream.written
    .slice(2)
    .filter((text) => text.startsWith('data: '))
    .map((text) => JSON.parse(text.slice('data: '.length)) as Record<string, unknown>);
}

function types(stream: RecordedStream): unknown[] {
  return messages(stream).map((message) => message['type']);
}

function hello(device: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    device,
    launch: L1,
    userAgent: IPHONE,
    screen: { width: 393, height: 852, dpr: 3 },
    secureContext: false,
    state: 'running',
    backend: 'webgl',
    error: null,
    ...overrides,
  };
}

function status(device: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { v: 1, device, state: 'running', backend: 'webgl', error: null, ...overrides };
}

/** A device id, distinct for each number. */
const id = (n: number): string => `device${String(n).padStart(4, '0')}`;

let current: string | null;
/** What a page draws for itself, as the launch options say. */
let clientOptions: { stats: boolean };
let changes: number;
/** What the link handed on of the devices' lines. */
let handed: DeviceLogs[];
let traced: string[];
let link: DeviceLink;

beforeEach(() => {
  vi.useFakeTimers();
  current = L1;
  clientOptions = { stats: false };
  changes = 0;
  handed = [];
  traced = [];
  link = new DeviceLink({
    currentLaunch: () => current,
    clientOptions: () => clientOptions,
    onChange: () => {
      changes += 1;
    },
    onLog: (logs) => {
      handed.push(logs);
    },
    trace: (line) => {
      traced.push(line);
    },
  });
});

afterEach(() => {
  link.stop();
  vi.useRealTimers();
});

/** A device with a stream open, which said hello. */
function connect(device: string, overrides: Record<string, unknown> = {}): RecordedStream {
  const stream = recorded();
  link.open({ device, token: TOKEN, address: '192.168.1.20', stream });
  link.receive('hello', hello(device, overrides));
  return stream;
}

describe('a stream', () => {
  it('starts by telling the browser how soon to reconnect, then the page what to draw', () => {
    const stream = recorded();
    link.open({ device: id(1), token: TOKEN, address: '192.168.1.20', stream });

    expect(stream.written).toEqual([
      'retry: 2000\n\n',
      'data: {"v":1,"type":"options","stats":false}\n\n',
    ]);
  });

  it('starts with stats on screen when the launch options draw them', () => {
    clientOptions = { stats: true };
    const stream = recorded();
    link.open({ device: id(1), token: TOKEN, address: '192.168.1.20', stream });

    expect(stream.written[1]).toBe('data: {"v":1,"type":"options","stats":true}\n\n');
  });
});

describe('the options a page draws by', () => {
  it('reach every stream of every device when they change, and say how many devices', () => {
    const phone = connect(id(1));
    const secondTab = recorded();
    link.open({ device: id(1), token: TOKEN, address: '192.168.1.20', stream: secondTab });
    const tablet = connect(id(2));
    changes = 0;

    clientOptions = { stats: true };
    expect(link.sendOptions()).toBe(2);

    for (const stream of [phone, secondTab, tablet]) {
      expect(messages(stream)).toEqual([{ v: 1, type: 'options', stats: true }]);
    }
    // No row reads differently: what a page draws for itself is not shown in one.
    expect(changes).toBe(0);
  });
});

describe('a launch', () => {
  it('reaches every device, which starts booting', () => {
    const first = connect(id(1));
    const second = connect(id(2));

    current = L2;
    const told = link.launch(L2);

    expect(told).toBe(2);
    expect(messages(first)).toEqual([{ v: 1, type: 'launch', launch: L2 }]);
    expect(messages(second)).toEqual([{ v: 1, type: 'launch', launch: L2 }]);
    expect(link.list().map((device) => device.state)).toEqual(['booting', 'booting']);
  });

  it('reaches every stream of a device', () => {
    const first = connect(id(1));
    const second = recorded();
    link.open({ device: id(1), token: TOKEN, address: '192.168.1.20', stream: second });

    link.launch(L2);

    expect(types(first)).toEqual(['launch']);
    expect(types(second)).toEqual(['launch']);
  });
});

describe('a hello', () => {
  it('restarts a page on another launch, and that device alone', () => {
    current = L2;
    const behind = connect(id(1), { launch: L1 });
    const upToDate = connect(id(2), { launch: L2 });

    expect(messages(behind)).toEqual([{ v: 1, type: 'launch', launch: L2 }]);
    expect(messages(upToDate)).toEqual([]);
    expect(link.list().map((device) => device.state)).toEqual(['booting', 'running']);
  });

  it('starts the game on the waiting page', () => {
    const waiting = connect(id(1), { launch: null, state: 'waiting', backend: null });

    expect(messages(waiting)).toEqual([{ v: 1, type: 'launch', launch: L1 }]);
  });

  it('restarts nothing while nothing is launched', () => {
    current = null;
    const waiting = connect(id(1), { launch: null, state: 'waiting', backend: null });

    expect(messages(waiting)).toEqual([]);
  });

  it('names the device from its user agent', () => {
    connect(id(1));

    expect(link.list()).toEqual([
      {
        id: id(1),
        name: 'iPhone',
        browser: 'Safari',
        userAgent: IPHONE,
        address: '192.168.1.20',
        screen: { width: 393, height: 852, dpr: 3 },
        secureContext: false,
        launch: L1,
        state: 'running',
        backend: 'webgl',
        error: null,
        stats: null,
        reloads: 0,
        connected: true,
      },
    ]);
  });

  it('lists devices in the order they said hello', () => {
    const late = recorded();
    link.open({ device: id(1), token: TOKEN, address: '192.168.1.20', stream: late });
    connect(id(2));
    link.receive('hello', hello(id(1)));

    expect(link.list().map((device) => device.id)).toEqual([id(2), id(1)]);
  });
});

describe('a status', () => {
  it('is applied, and a heartbeat that changes nothing says nothing', () => {
    connect(id(1), { state: 'booting', backend: null });
    changes = 0;

    expect(link.receive('status', status(id(1)))).toBe('applied');
    expect(link.list()[0]).toMatchObject({ state: 'running', backend: 'webgl' });
    expect(changes).toBe(1);

    link.receive('status', status(id(1)));
    expect(changes).toBe(1);
  });

  it('is ignored from a device that never said hello', () => {
    link.open({ device: id(1), token: TOKEN, address: '192.168.1.20', stream: recorded() });

    expect(link.receive('status', status(id(1)))).toBe('ignored');
    expect(link.list()).toEqual([]);
  });

  it('is ignored from a device with no stream, malformed, or of a type it does not know', () => {
    expect(link.receive('hello', hello(id(1)))).toBe('ignored');
    connect(id(2));
    expect(link.receive('status', { v: 2, device: id(2), state: 'running' })).toBe('ignored');
    expect(link.receive('dance', status(id(2)))).toBe('ignored');
  });
});

describe('a batch of lines', () => {
  const lines = [
    { level: 'log', text: 'Shout loaded', count: 1 },
    { level: 'error', text: 'Uncaught Error: late boom (scripts.mjs:57:13)', count: 2 },
  ];

  function log(device: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { v: 1, device, launch: L1, lines, dropped: 0, ...overrides };
  }

  it('is handed on with the device’s name and browser, and changes no row', () => {
    connect(id(1));
    changes = 0;

    expect(link.receive('log', log(id(1), { dropped: 3 }))).toBe('applied');

    expect(handed).toEqual([
      { device: id(1), name: 'iPhone', browser: 'Safari', lines, dropped: 3 },
    ]);
    expect(changes).toBe(0);
  });

  it('says in the trace that lines were lost, and never what they said', () => {
    connect(id(1));

    link.receive('log', log(id(1), { dropped: 3 }));

    expect(traced.filter((line) => line.includes('lost'))).toEqual([
      `${id(1)} lost 3 lines on the way`,
    ]);
    expect(traced.join('\n')).not.toContain('Shout loaded');
  });

  it('is ignored from a device that never said hello', () => {
    link.open({ device: id(1), token: TOKEN, address: '192.168.1.20', stream: recorded() });

    expect(link.receive('log', log(id(1)))).toBe('ignored');
    expect(handed).toEqual([]);
  });

  it('is ignored when it is no batch', () => {
    connect(id(1));

    expect(link.receive('log', log(id(1), { lines: 'x' }))).toBe('ignored');
    expect(link.receive('log', log(id(1), { v: 2 }))).toBe('ignored');
    expect(handed).toEqual([]);
  });

  it('is ignored when its page ran a launch that is no longer current, and spends no rate', () => {
    // The last batch a page sends as it goes arrives once the next launch is
    // current: that run's lines have left every Console.
    current = L2;
    connect(id(1), { launch: L2 });

    for (let n = 0; n < 60; n += 1) expect(link.receive('log', log(id(1), { launch: L1 }))).toBe('ignored');
    expect(handed).toEqual([]);

    expect(link.receive('log', log(id(1), { launch: L2 }))).toBe('applied');
    expect(handed).toHaveLength(1);
  });

  it('is handed on from the waiting page while nothing is launched, and from no other launch', () => {
    current = null;
    connect(id(1), { launch: null, state: 'waiting', backend: null });

    expect(link.receive('log', log(id(1), { launch: null }))).toBe('applied');
    expect(link.receive('log', log(id(1), { launch: L1 }))).toBe('ignored');
    expect(handed).toHaveLength(1);
  });

  it('hands nothing on when it holds no line and lost none', () => {
    connect(id(1));

    expect(link.receive('log', log(id(1), { lines: [] }))).toBe('applied');
    expect(handed).toEqual([]);
  });

  it('is limited to 50 in 10 s, which the link’s own messages never spend', () => {
    connect(id(1));

    for (let n = 0; n < 50; n += 1) expect(link.receive('log', log(id(1)))).toBe('applied');
    expect(link.receive('log', log(id(1)))).toBe('limited');
    expect(link.receive('status', status(id(1)))).toBe('applied');

    expect(handed).toHaveLength(50);
    expect(traced.filter((line) => line.includes('refused'))).toEqual([
      `${id(1)} sent lines too fast: a batch was refused`,
    ]);
    vi.advanceTimersByTime(10_000);
    expect(link.receive('log', log(id(1)))).toBe('applied');
  });

  it('spends nothing of the link’s rate, nor the link of its', () => {
    // A hello and nineteen statuses: the link's twenty.
    connect(id(1));
    for (let n = 0; n < 19; n += 1) expect(link.receive('status', status(id(1)))).toBe('applied');

    for (let n = 0; n < 50; n += 1) expect(link.receive('log', log(id(1)))).toBe('applied');
    expect(link.receive('status', status(id(1)))).toBe('limited');
  });
});

describe('a page’s stats', () => {
  function report(device: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      v: 1,
      device,
      launch: L1,
      fps: 58,
      p95: 21.4,
      frames: 116,
      drawCalls: 142,
      triangles: 85_210,
      textures: 31,
      gpuMemory: 188_743_680,
      pixelRatio: 3,
      width: 1179,
      height: 2556,
      pinned30: false,
      ...overrides,
    };
  }

  const kept = {
    fps: 58,
    p95: 21.4,
    frames: 116,
    drawCalls: 142,
    triangles: 85_210,
    textures: 31,
    gpuMemory: 188_743_680,
    pixelRatio: 3,
    width: 1179,
    height: 2556,
    pinned30: false,
  };

  it('are kept on the device’s row, from a page on the current launch', () => {
    connect(id(1));
    changes = 0;

    expect(link.receive('stats', report(id(1)))).toBe('applied');

    expect(link.list()[0]?.stats).toEqual(kept);
    expect(changes).toBe(1);
  });

  it('are ignored from a page on another launch, from a device that never said hello, or malformed', () => {
    current = L2;
    connect(id(1), { launch: L2 });
    link.open({ device: id(2), token: TOKEN, address: '192.168.1.21', stream: recorded() });

    expect(link.receive('stats', report(id(1), { launch: L1 }))).toBe('ignored');
    expect(link.receive('stats', report(id(2), { launch: L2 }))).toBe('ignored');
    expect(link.receive('stats', report(id(1), { v: 2, launch: L2 }))).toBe('ignored');
    expect(link.list()[0]?.stats).toBeNull();
  });

  it('are limited to 10 in 10 s, which spend nothing the link and the lines need', () => {
    connect(id(1));

    for (let n = 0; n < 10; n += 1) expect(link.receive('stats', report(id(1)))).toBe('applied');
    expect(link.receive('stats', report(id(1)))).toBe('limited');

    expect(link.receive('status', status(id(1)))).toBe('applied');
    expect(
      link.receive('log', { v: 1, device: id(1), launch: L1, lines: [], dropped: 0 }),
    ).toBe('applied');
    vi.advanceTimersByTime(10_000);
    expect(link.receive('stats', report(id(1)))).toBe('applied');
  });

  it('are emptied when the device is told to restart: every page is measured on its own', () => {
    connect(id(1));
    connect(id(2));
    link.receive('stats', report(id(1)));
    link.receive('stats', report(id(2)));

    current = L2;
    link.launch(L2);
    expect(link.list().map((device) => device.stats)).toEqual([null, null]);

    link.receive('stats', report(id(1), { launch: L2 }));
    link.restart(id(1), L2);
    expect(link.list()[0]?.stats).toBeNull();
  });

  it('are emptied by a hello, which is a new page or a new stream', () => {
    connect(id(1));
    link.receive('stats', report(id(1)));

    link.receive('hello', hello(id(1)));

    expect(link.list()[0]?.stats).toBeNull();
  });

  it('are emptied when the device’s last stream ends', () => {
    const stream = recorded();
    const close = link.open({ device: id(1), token: TOKEN, address: '192.168.1.20', stream });
    link.receive('hello', hello(id(1), { reloaded: true }));
    link.receive('stats', report(id(1)));

    close?.();

    expect(link.list()[0]).toMatchObject({ connected: false, stats: null, reloads: 1 });
  });

  it('say in the trace when a device is held at 30 fps, and when it no longer is', () => {
    connect(id(1));

    link.receive('stats', report(id(1)));
    link.receive('stats', report(id(1), { fps: 30, pinned30: true }));
    link.receive('stats', report(id(1), { fps: 30, pinned30: true }));
    link.receive('stats', report(id(1), { fps: 60 }));

    expect(traced.filter((line) => line.includes('30 fps'))).toEqual([
      'iPhone · Safari held at 30 fps',
      'iPhone · Safari no longer held at 30 fps',
    ]);
    // A report itself is never traced: one every two seconds per device.
    expect(traced.join('\n')).not.toContain('58');
  });
});

describe('a reload nobody asked for', () => {
  it('is counted on the device, and traced', () => {
    connect(id(1), { reloaded: true });

    expect(link.list()[0]?.reloads).toBe(1);
    expect(traced).toContain('iPhone · Safari was reloaded by its browser');

    link.receive('hello', hello(id(1), { reloaded: true }));
    expect(link.list()[0]?.reloads).toBe(2);
    link.receive('hello', hello(id(1)));
    expect(link.list()[0]?.reloads).toBe(2);
  });

  it('outlives every launch, and goes with the device once it is forgotten', () => {
    const stream = recorded();
    const close = link.open({ device: id(1), token: TOKEN, address: '192.168.1.20', stream });
    link.receive('hello', hello(id(1), { reloaded: true }));

    current = L2;
    link.launch(L2);
    expect(link.list()[0]?.reloads).toBe(1);

    close?.();
    vi.advanceTimersByTime(35_000);
    expect(link.list()).toEqual([]);
    connect(id(1));
    expect(link.list()[0]?.reloads).toBe(0);
  });
});

describe('keeping the link alive', () => {
  it('pings every stream every 15 s', () => {
    const stream = connect(id(1));

    vi.advanceTimersByTime(15_000);
    expect(types(stream)).toEqual(['ping']);
    vi.advanceTimersByTime(15_000);
    expect(types(stream)).toEqual(['ping', 'ping']);
  });

  it('ends the streams of a device silent for 60 s, lists it offline, then forgets it', () => {
    const stream = connect(id(1));

    vi.advanceTimersByTime(55_000);
    expect(stream.ended).toBe(false);
    vi.advanceTimersByTime(5_000);
    expect(stream.ended).toBe(true);
    expect(link.list()).toMatchObject([{ id: id(1), connected: false }]);

    vi.advanceTimersByTime(30_000);
    expect(link.list()).toEqual([]);
  });

  it('keeps a device that posts its status', () => {
    const stream = connect(id(1));

    for (let i = 0; i < 6; i += 1) {
      vi.advanceTimersByTime(20_000);
      link.receive('status', status(id(1)));
    }

    expect(stream.ended).toBe(false);
  });

  it('lists a device whose stream closed as offline, and back once it reopens', () => {
    const stream = recorded();
    const close = link.open({ device: id(1), token: TOKEN, address: '192.168.1.20', stream });
    link.receive('hello', hello(id(1)));

    close?.();
    expect(link.list()).toMatchObject([{ connected: false }]);
    link.open({ device: id(1), token: TOKEN, address: '192.168.1.21', stream: recorded() });
    expect(link.list()).toMatchObject([{ connected: true }]);
  });
});

describe('limits', () => {
  it('refuses a 33rd device', () => {
    for (let n = 1; n <= 32; n += 1) {
      expect(link.open({ device: id(n), token: TOKEN, address: '10.0.0.1', stream: recorded() }))
        .not.toBeNull();
    }

    expect(link.open({ device: id(33), token: TOKEN, address: '10.0.0.1', stream: recorded() }))
      .toBeNull();
  });

  it('refuses a fifth stream for one device', () => {
    for (let n = 1; n <= 4; n += 1) {
      expect(link.open({ device: id(1), token: TOKEN, address: '10.0.0.1', stream: recorded() }))
        .not.toBeNull();
    }

    expect(link.open({ device: id(1), token: TOKEN, address: '10.0.0.1', stream: recorded() }))
      .toBeNull();
  });

  it('limits a device to 20 messages in 10 s', () => {
    connect(id(1));
    for (let n = 2; n <= 20; n += 1) {
      expect(link.receive('status', status(id(1)))).toBe('applied');
    }

    expect(link.receive('status', status(id(1)))).toBe('limited');
    vi.advanceTimersByTime(10_000);
    expect(link.receive('status', status(id(1)))).toBe('applied');
  });
});

describe('restarting one device', () => {
  it('reaches that device alone', () => {
    const first = connect(id(1));
    const second = connect(id(2));

    expect(link.restart(id(1), L1)).toBe(true);

    expect(messages(first)).toEqual([{ v: 1, type: 'launch', launch: L1 }]);
    expect(messages(second)).toEqual([]);
    expect(link.list().map((device) => device.state)).toEqual(['booting', 'running']);
  });

  it('cannot reach a device that is offline', () => {
    const stream = recorded();
    const close = link.open({ device: id(1), token: TOKEN, address: '192.168.1.20', stream });
    link.receive('hello', hello(id(1)));
    close?.();

    expect(link.restart(id(1), L1)).toBe(false);
    expect(link.restart(id(9), L1)).toBe(false);
  });
});

describe('stopping', () => {
  it('tells every stream, ends it, and forgets every device', () => {
    const stream = connect(id(1));

    link.stop();

    expect(types(stream)).toEqual(['stopped']);
    expect(stream.ended).toBe(true);
    expect(link.list()).toEqual([]);
  });
});

describe('a change of transport', () => {
  it('tells every stream to reopen under the new scheme, ends it, and forgets every device', () => {
    const phone = connect(id(1));
    const secondTab = recorded();
    link.open({ device: id(1), token: TOKEN, address: '192.168.1.20', stream: secondTab });
    const tablet = connect(id(2));
    changes = 0;

    link.reopen('https');

    // Each page comes back on another origin, whose storage holds another
    // device id: the rows it had are nobody's now.
    for (const stream of [phone, secondTab, tablet]) {
      expect(messages(stream)).toEqual([{ v: 1, type: 'reopen', transport: 'https' }]);
      expect(stream.ended).toBe(true);
    }
    expect(link.list()).toEqual([]);
    expect(changes).toBe(1);
  });

  it('keeps the link going for the pages that come back', () => {
    connect(id(1));
    link.reopen('https');

    const back = connect(id(3));

    expect(link.list().map((device) => device.id)).toEqual([id(3)]);
    vi.advanceTimersByTime(15_000);
    expect(types(back)).toEqual(['ping']);
  });
});

describe('a new link', () => {
  it('ends the streams opened with the old token, and forgets their devices', () => {
    const old = connect(id(1));
    const fresh = recorded();
    link.open({ device: id(2), token: 'newtokennewtokennewtok', address: '192.168.1.21', stream: fresh });
    link.receive('hello', hello(id(2)));

    link.closeOpenedWithout('newtokennewtokennewtok');

    expect(old.ended).toBe(true);
    expect(fresh.ended).toBe(false);
    expect(link.list().map((device) => device.id)).toEqual([id(2)]);
  });
});
