import {
  DEVICE_LOG_LINES,
  DEVICE_LOG_TEXT,
  DEVICE_PROTOCOL_VERSION,
  conformHello,
  conformLogMessage,
  conformStatusReport,
  createId,
  cutLogText,
  isDeviceId,
  parseServerMessage,
  type DeviceHello,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';

/*
 * What a device and the server say to each other.
 *
 * A device's message arrives from anything on the network that knows the
 * link — a phone, or a page someone wrote to see what the server does with
 * nonsense — so every value below that is not a complete hello is wrong on
 * purpose, one field at a time.
 */

const DEVICE = 'Ab3dE6gH9jK2mN5p';

function hello(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    device: DEVICE,
    launch: 'L1aunch0000a',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    screen: { width: 393, height: 852, dpr: 3 },
    secureContext: false,
    state: 'booting',
    backend: null,
    error: null,
    ...overrides,
  };
}

describe('a device’s hello', () => {
  it('comes back equal when it is complete', () => {
    const complete = hello({ state: 'running', backend: 'webgl' });

    expect(conformHello(complete)).toEqual(complete);
    expect(DEVICE_PROTOCOL_VERSION).toBe(1);
  });

  it.each([
    ['another version', hello({ v: 2 })],
    ['no version', hello({ v: undefined })],
    ['an id holding a slash', hello({ device: 'Ab3dE6gH/jK2mN5p' })],
    ['an id of seven characters', hello({ device: 'Ab3dE6g' })],
    ['not an object', 'hello'],
    ['nothing', null],
  ])('is refused for %s', (_name, value) => {
    expect(conformHello(value)).toBeNull();
  });

  it('cuts a user agent to 512 characters', () => {
    const conformed = conformHello(hello({ userAgent: 'x'.repeat(2000) }));

    expect(conformed?.userAgent).toHaveLength(512);
  });

  it('makes a screen of numbers that can be shown', () => {
    const screen = conformHello(hello({ screen: { width: 'x', dpr: Infinity } }))?.screen;

    for (const value of Object.values(screen ?? {})) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(screen).toEqual({ width: 0, height: 0, dpr: 1 });
  });

  it('knows no backend but WebGPU and WebGL2', () => {
    expect(conformHello(hello({ backend: 'metal' }))?.backend).toBeNull();
    expect(conformHello(hello({ backend: 'webgpu' }))?.backend).toBe('webgpu');
  });

  it('reads an unknown state as waiting', () => {
    expect(conformHello(hello({ state: 'dancing' }))?.state).toBe('waiting');
  });

  it('names a launch by its id, or none', () => {
    expect(conformHello(hello({ launch: 42 }))?.launch).toBeNull();
    expect(conformHello(hello({ launch: '../../etc' }))?.launch).toBeNull();
    expect(conformHello(hello({ launch: null }))?.launch).toBeNull();
  });

  it('keeps a page that is not a secure context as one', () => {
    expect(conformHello(hello({ secureContext: 'yes' }))?.secureContext).toBe(false);
    expect(conformHello(hello({ secureContext: true }))?.secureContext).toBe(true);
  });

  it('cuts an error to 2 000 characters', () => {
    const conformed: DeviceHello | null = conformHello(
      hello({ state: 'failed', error: 'e'.repeat(5000) }),
    );

    expect(conformed?.error).toHaveLength(2000);
  });
});

describe('a device’s status', () => {
  it('comes back equal when it is complete', () => {
    const status = { v: 1, device: DEVICE, state: 'failed', backend: 'webgl', error: 'No GPU' };

    expect(conformStatusReport(status)).toEqual(status);
  });

  it('is refused for a state it does not know', () => {
    expect(
      conformStatusReport({ v: 1, device: DEVICE, state: 'dancing', backend: null, error: null }),
    ).toBeNull();
  });

  it('is refused from an id that is not one', () => {
    expect(
      conformStatusReport({ v: 1, device: '../x', state: 'running', backend: null, error: null }),
    ).toBeNull();
  });
});

describe('a device’s lines', () => {
  function log(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      v: 1,
      device: DEVICE,
      lines: [
        { level: 'log', text: 'Shout loaded', count: 1 },
        { level: 'warn', text: 'careful', count: 3 },
        { level: 'error', text: 'Uncaught Error: late boom (scripts.mjs:57:13)', count: 1 },
      ],
      dropped: 2,
      ...overrides,
    };
  }

  const line = (overrides: Record<string, unknown> = {}) => ({
    level: 'log',
    text: 'x',
    count: 1,
    ...overrides,
  });

  it('come back equal when they are complete', () => {
    const complete = log();

    expect(conformLogMessage(complete)).toEqual(complete);
  });

  it.each([
    ['another version', log({ v: 2 })],
    ['no device', log({ device: undefined })],
    ['an id of seven characters', log({ device: 'Ab3dE6g' })],
    ['lines that are not a list', log({ lines: 'x' })],
    ['nothing', null],
  ])('are refused for %s', (_name, value) => {
    expect(conformLogMessage(value)).toBeNull();
  });

  it('keep a hundred lines a batch, and count the rest as dropped', () => {
    const lines = Array.from({ length: 120 }, (_, i) => line({ text: `line ${i}` }));

    const conformed = conformLogMessage(log({ lines, dropped: 0 }));

    expect(conformed?.lines).toHaveLength(DEVICE_LOG_LINES);
    expect(conformed?.lines.at(-1)?.text).toBe('line 99');
    expect(conformed?.dropped).toBe(20);
  });

  it('cut a line to 4 000 characters, the last one an ellipsis', () => {
    const conformed = conformLogMessage(log({ lines: [line({ text: 'x'.repeat(5_000) })] }));
    const text = conformed?.lines[0]?.text ?? '';

    expect(text).toHaveLength(DEVICE_LOG_TEXT);
    expect(text.endsWith('…')).toBe(true);
    expect(cutLogText('y'.repeat(DEVICE_LOG_TEXT))).toBe('y'.repeat(DEVICE_LOG_TEXT));
  });

  it('read a level they do not know as a message', () => {
    expect(conformLogMessage(log({ lines: [line({ level: 'debug' })] }))?.lines[0]?.level).toBe(
      'log',
    );
  });

  it.each([0, 2.5, '3', -1])('read a count of %s as one', (count) => {
    expect(conformLogMessage(log({ lines: [line({ count })] }))?.lines[0]?.count).toBe(1);
  });

  it.each([-4, 'x', 1.5, undefined])('read a dropped count of %s as none', (dropped) => {
    expect(conformLogMessage(log({ dropped }))?.dropped).toBe(0);
  });

  it('leave out a line with no text, and count it as dropped', () => {
    const conformed = conformLogMessage(
      log({ lines: [line({ text: 'kept' }), line({ text: 42 }), 'not a line'], dropped: 1 }),
    );

    expect(conformed?.lines).toEqual([line({ text: 'kept' })]);
    expect(conformed?.dropped).toBe(3);
  });
});

describe('what the server sends', () => {
  it('reads the four messages', () => {
    expect(parseServerMessage('{"v":1,"type":"launch","launch":"L2aunch0000b"}')).toEqual({
      v: 1,
      type: 'launch',
      launch: 'L2aunch0000b',
    });
    expect(parseServerMessage('{"v":1,"type":"stopped"}')).toEqual({ v: 1, type: 'stopped' });
    expect(parseServerMessage('{"v":1,"type":"ping"}')).toEqual({ v: 1, type: 'ping' });
    expect(parseServerMessage('{"v":1,"type":"reopen","transport":"https"}')).toEqual({
      v: 1,
      type: 'reopen',
      transport: 'https',
    });
  });

  it.each([
    ['another version', '{"v":2,"type":"launch","launch":"L2aunch0000b"}'],
    ['a type it does not know', '{"v":1,"type":"x"}'],
    ['a launch without its id', '{"v":1,"type":"launch"}'],
    // A page sent to a scheme no build serves would load nothing at all.
    ['a reopen on a transport it does not know', '{"v":1,"type":"reopen","transport":"ftp"}'],
    ['a reopen without its transport', '{"v":1,"type":"reopen"}'],
    ['what is not JSON', 'not json'],
    ['JSON that is not an object', '42'],
  ])('ignores %s', (_name, data) => {
    expect(parseServerMessage(data)).toBeNull();
  });
});

describe('a device id', () => {
  it('is what the client makes', () => {
    expect(isDeviceId(createId(16))).toBe(true);
  });

  it('is letters and digits, 8 to 64 of them', () => {
    expect(isDeviceId('Ab3dE6gH')).toBe(true);
    expect(isDeviceId('A'.repeat(65))).toBe(false);
    expect(isDeviceId('Ab3dE6g_')).toBe(false);
    expect(isDeviceId(12345678)).toBe(false);
  });
});
