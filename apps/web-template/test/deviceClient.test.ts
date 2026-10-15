import type { SceneHost } from '@three-studio/runtime/SceneHost';
import type { WebGPURenderer } from 'three/webgpu';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerAnnouncement } from '../src/announce';
import {
  startDeviceClient,
  type DeviceIo,
  type DeviceNotice,
  type DevicePage,
  type ProbeAnswer,
  type StreamHandlers,
} from '../src/device/client';
import { createLogQueue } from '../src/device/logQueue';

/*
 * The client a served page runs, with everything around it faked: the stream,
 * the posts, the page's reload and its words. What is left is what the client
 * decides — when it says hello, when it restarts, when it gives up — and that
 * is what a phone left on its bookmark depends on.
 */

const DEVICE = 'Ab3dE6gH9jK2mN5p';

interface Stream {
  handlers: StreamHandlers;
  closed: boolean;
}

function page(overrides: Partial<DevicePage> = {}): DevicePage {
  return {
    device: DEVICE,
    launch: 'L1aunch0000a',
    asked: false,
    identity: {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      screen: { width: 393, height: 852, dpr: 3 },
      secureContext: false,
    },
    ...overrides,
  };
}

interface Post {
  type: string;
  message: Record<string, unknown>;
  keepalive?: true;
}

function fakeIo() {
  const streams: Stream[] = [];
  const posts: Post[] = [];
  const shown: DeviceNotice[] = [];
  /** The client's own lines, which it writes through `io.log`. */
  const logged: string[] = [];
  /**
   * What the server answers: a status, at once — 0 for no answer at all — or
   * `held`, until the test releases it.
   */
  const answer: { probe: ProbeAnswer; post: (type: string) => number | 'held' } = {
    probe: 'unreachable',
    post: () => 204,
  };
  const held: ((status: number) => void)[] = [];
  const reload = vi.fn();
  const reopen = vi.fn();
  const io: DeviceIo = {
    openStream: (handlers) => {
      const stream: Stream = { handlers, closed: false };
      streams.push(stream);
      return {
        close: () => {
          stream.closed = true;
        },
      };
    },
    post: (type, message, options) => {
      posts.push(
        options?.keepalive === true
          ? { type, message: { ...message }, keepalive: true }
          : { type, message: { ...message } },
      );
      const status = answer.post(type);
      if (status === 'held') return new Promise((resolve) => held.push(resolve));
      return Promise.resolve(status);
    },
    probe: () => Promise.resolve(answer.probe),
    reload,
    reopen,
    show: (notice) => {
      shown.push(notice);
    },
    log: (line) => {
      logged.push(line);
    },
  };
  const last = (): Stream => streams.at(-1)!;
  /** Answers the oldest post still held. */
  const release = (status: number): void => {
    held.shift()?.(status);
  };
  const logs = createLogQueue();
  return { io, streams, posts, shown, logged, answer, release, reload, reopen, last, logs };
}

function running(start = vi.fn()): PlayerAnnouncement {
  return {
    state: 'running',
    backend: 'webgl',
    renderer: {} as unknown as WebGPURenderer,
    host: {} as unknown as SceneHost,
    start,
  };
}

const message = (body: Record<string, unknown>): string => JSON.stringify({ v: 1, ...body });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('opening', () => {
  it('says hello with the launch its page runs, booting on a player page', () => {
    const fake = fakeIo();
    startDeviceClient(page(), fake.io, fake.logs);

    expect(fake.streams).toHaveLength(1);
    expect(fake.posts).toEqual([]);
    fake.last().handlers.onOpen();

    expect(fake.posts).toEqual([
      {
        type: 'hello',
        message: {
          v: 1,
          device: DEVICE,
          launch: 'L1aunch0000a',
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
          screen: { width: 393, height: 852, dpr: 3 },
          secureContext: false,
          state: 'booting',
          backend: null,
          error: null,
          reloaded: false,
        },
      },
    ]);
    expect(fake.shown).toEqual(['connected']);
  });

  it('says it waits on the waiting page', () => {
    const fake = fakeIo();
    startDeviceClient(page({ launch: null }), fake.io, fake.logs);
    fake.last().handlers.onOpen();

    expect(fake.posts[0]?.message).toMatchObject({ launch: null, state: 'waiting' });
  });
});

describe('the player', () => {
  it('reports that it runs, and on what', () => {
    const fake = fakeIo();
    const client = startDeviceClient(page(), fake.io, fake.logs);
    fake.last().handlers.onOpen();

    client.playerAnnounced(running());

    expect(fake.posts.at(-1)).toEqual({
      type: 'status',
      message: { v: 1, device: DEVICE, state: 'running', backend: 'webgl', error: null },
    });
  });

  it('reports what it failed on', () => {
    const fake = fakeIo();
    const client = startDeviceClient(page(), fake.io, fake.logs);
    fake.last().handlers.onOpen();

    client.playerAnnounced({ state: 'failed', error: 'No scene to start on.' });

    expect(fake.posts.at(-1)?.message).toMatchObject({
      state: 'failed',
      error: 'No scene to start on.',
    });
  });

  it('says hello with what the player said before the stream opened', () => {
    const fake = fakeIo();
    const client = startDeviceClient(page(), fake.io, fake.logs);

    client.playerAnnounced(running());
    expect(fake.posts).toEqual([]);
    fake.last().handlers.onOpen();

    expect(fake.posts).toHaveLength(1);
    expect(fake.posts[0]?.message).toMatchObject({ state: 'running', backend: 'webgl' });
  });

  it('starts the game when the editor asked for this page', () => {
    const fake = fakeIo();
    const start = vi.fn();
    const client = startDeviceClient(page({ asked: true }), fake.io, fake.logs);

    client.playerAnnounced(running(start));

    expect(start).toHaveBeenCalledTimes(1);
  });

  it('leaves the Play screen to a page opened by hand', () => {
    const fake = fakeIo();
    const start = vi.fn();
    const client = startDeviceClient(page({ asked: false }), fake.io, fake.logs);

    client.playerAnnounced(running(start));

    expect(start).not.toHaveBeenCalled();
  });
});

describe('what the server says', () => {
  it('restarts once on a launch, and does nothing after it', () => {
    const fake = fakeIo();
    startDeviceClient(page(), fake.io, fake.logs);
    const stream = fake.last();
    stream.handlers.onOpen();
    const posted = fake.posts.length;

    stream.handlers.onMessage(message({ type: 'launch', launch: 'L2aunch0000b' }));
    stream.handlers.onMessage(message({ type: 'launch', launch: 'L3aunch0000c' }));
    vi.advanceTimersByTime(120_000);

    expect(fake.reload).toHaveBeenCalledTimes(1);
    expect(fake.posts).toHaveLength(posted);
    expect(fake.streams).toHaveLength(1);
  });

  it('reopens the page on the other scheme once, and does nothing after it', () => {
    const fake = fakeIo();
    startDeviceClient(page(), fake.io, fake.logs);
    const stream = fake.last();
    stream.handlers.onOpen();
    const posted = fake.posts.length;

    stream.handlers.onMessage(message({ type: 'reopen', transport: 'https' }));
    stream.handlers.onMessage(message({ type: 'reopen', transport: 'http' }));
    stream.handlers.onMessage(message({ type: 'launch', launch: 'L2aunch0000b' }));
    vi.advanceTimersByTime(120_000);

    expect(fake.reopen).toHaveBeenCalledExactlyOnceWith('https');
    expect(fake.reload).not.toHaveBeenCalled();
    expect(fake.posts).toHaveLength(posted);
    expect(fake.streams).toHaveLength(1);
  });

  it('says the editor stopped, and keeps saying it through the errors that follow', () => {
    const fake = fakeIo();
    startDeviceClient(page({ launch: null }), fake.io, fake.logs);
    const stream = fake.last();
    stream.handlers.onOpen();

    stream.handlers.onMessage(message({ type: 'stopped' }));
    stream.handlers.onError(false);

    expect(fake.shown.at(-1)).toBe('stopped');
  });

  it('ignores a message it does not know, and another version', () => {
    const fake = fakeIo();
    startDeviceClient(page(), fake.io, fake.logs);
    const stream = fake.last();
    stream.handlers.onOpen();
    const posted = fake.posts.length;

    stream.handlers.onMessage(message({ type: 'dance' }));
    stream.handlers.onMessage(JSON.stringify({ v: 2, type: 'launch', launch: 'L2aunch0000b' }));
    stream.handlers.onMessage('not json');

    expect(fake.reload).not.toHaveBeenCalled();
    expect(fake.posts).toHaveLength(posted);
    expect(fake.shown).toEqual(['connected']);
  });
});

describe('keeping the link alive', () => {
  it('posts its status every 20 s', () => {
    const fake = fakeIo();
    startDeviceClient(page(), fake.io, fake.logs);
    const stream = fake.last();
    stream.handlers.onOpen();

    for (let i = 0; i < 3; i += 1) {
      vi.advanceTimersByTime(15_000);
      stream.handlers.onMessage(message({ type: 'ping' }));
    }
    vi.advanceTimersByTime(15_000);

    expect(fake.posts.filter((post) => post.type === 'status')).toHaveLength(3);
  });

  it('reopens a stream that has said nothing for 45 s, and says hello again', () => {
    const fake = fakeIo();
    startDeviceClient(page(), fake.io, fake.logs);
    const first = fake.last();
    first.handlers.onOpen();

    vi.advanceTimersByTime(44_999);
    expect(fake.streams).toHaveLength(1);
    vi.advanceTimersByTime(1);

    expect(first.closed).toBe(true);
    expect(fake.streams).toHaveLength(2);
    fake.last().handlers.onOpen();
    expect(fake.posts.filter((post) => post.type === 'hello')).toHaveLength(2);
  });

  it('reopens on waking after 30 s of silence, not after 10 s', () => {
    const fake = fakeIo();
    const client = startDeviceClient(page(), fake.io, fake.logs);
    fake.last().handlers.onOpen();

    vi.advanceTimersByTime(10_000);
    client.wake();
    expect(fake.streams).toHaveLength(1);

    vi.advanceTimersByTime(20_000);
    client.wake();
    expect(fake.streams).toHaveLength(2);
  });

  it('says the editor cannot be reached while it connects, and connected once it has', () => {
    const fake = fakeIo();
    startDeviceClient(page(), fake.io, fake.logs);
    const stream = fake.last();
    stream.handlers.onOpen();

    stream.handlers.onError(false);
    expect(fake.shown.at(-1)).toBe('unreachable');
    stream.handlers.onOpen();
    expect(fake.shown.at(-1)).toBe('connected');
  });
});

describe('a stream closed for good', () => {
  it('stops for good when the link is gone', async () => {
    const fake = fakeIo();
    startDeviceClient(page(), fake.io, fake.logs);
    fake.last().handlers.onOpen();
    const posted = fake.posts.length;
    fake.answer.probe = 'gone';

    fake.last().handlers.onError(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(fake.shown.at(-1)).toBe('gone');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fake.streams).toHaveLength(1);
    expect(fake.posts).toHaveLength(posted);
  });

  it('tries again after 3 s, then 6 s, then 12 s, and from 3 s once a stream opens', async () => {
    const fake = fakeIo();
    startDeviceClient(page(), fake.io, fake.logs);
    fake.answer.probe = 'unreachable';

    const failAndWait = async (delay: number): Promise<void> => {
      const count = fake.streams.length;
      fake.last().handlers.onError(true);
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(fake.streams).toHaveLength(count);
      await vi.advanceTimersByTimeAsync(1);
      expect(fake.streams).toHaveLength(count + 1);
    };

    await failAndWait(3_000);
    expect(fake.shown.at(-1)).toBe('unreachable');
    await failAndWait(6_000);
    await failAndWait(12_000);
    fake.last().handlers.onOpen();
    await failAndWait(3_000);
  });
});

describe('the page’s lines', () => {
  const lines = (...texts: string[]) => texts.map((text) => ({ level: 'log', text, count: 1 }));
  const batches = (fake: ReturnType<typeof fakeIo>) =>
    fake.posts.filter((post) => post.type === 'log');

  /** A client whose hello has been answered. */
  async function linked(fake = fakeIo()) {
    const client = startDeviceClient(page(), fake.io, fake.logs);
    fake.last().handlers.onOpen();
    await vi.advanceTimersByTimeAsync(0);
    return { fake, client };
  }

  it('wait for the hello to be answered, then leave together, in order', async () => {
    const fake = fakeIo();
    fake.logs.push('log', 'Shout loaded');
    fake.logs.push('warn', 'careful');
    startDeviceClient(page(), fake.io, fake.logs);
    fake.answer.post = (type) => (type === 'hello' ? 'held' : 204);

    fake.last().handlers.onOpen();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(batches(fake)).toEqual([]);

    fake.release(204);
    await vi.advanceTimersByTimeAsync(0);

    expect(batches(fake)).toEqual([
      {
        type: 'log',
        message: {
          v: 1,
          device: DEVICE,
          launch: 'L1aunch0000a',
          lines: [
            { level: 'log', text: 'Shout loaded', count: 1 },
            { level: 'warn', text: 'careful', count: 1 },
          ],
          dropped: 0,
        },
      },
    ]);
  });

  it('name the launch their page runs, and none on the waiting page', async () => {
    const player = fakeIo();
    player.logs.push('log', 'Shout loaded');
    startDeviceClient(page(), player.io, player.logs);
    player.last().handlers.onOpen();
    const waiting = fakeIo();
    waiting.logs.push('log', 'still waiting');
    startDeviceClient(page({ launch: null }), waiting.io, waiting.logs);
    waiting.last().handlers.onOpen();

    await vi.advanceTimersByTimeAsync(0);

    expect(batches(player).map((post) => post.message['launch'])).toEqual(['L1aunch0000a']);
    expect(batches(waiting).map((post) => post.message['launch'])).toEqual([null]);
  });

  it('leave a quarter of a second after a line, one batch at a time', async () => {
    const { fake, client } = await linked();
    fake.answer.post = (type) => (type === 'log' ? 'held' : 204);

    fake.logs.push('log', 'a');
    client.logged();
    await vi.advanceTimersByTimeAsync(249);
    expect(batches(fake)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(batches(fake)).toHaveLength(1);

    fake.logs.push('log', 'b');
    client.logged();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(batches(fake)).toHaveLength(1);

    fake.release(204);
    await vi.advanceTimersByTimeAsync(249);
    expect(batches(fake)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(batches(fake).map((post) => post.message['lines'])).toEqual([lines('a'), lines('b')]);
  });

  it('wait for the next stream when the hello was not answered', async () => {
    const fake = fakeIo();
    fake.logs.push('log', 'early');
    const client = startDeviceClient(page(), fake.io, fake.logs);
    fake.answer.post = (type) => (type === 'hello' ? 0 : 204);

    fake.last().handlers.onOpen();
    await vi.advanceTimersByTimeAsync(1_000);
    client.logged();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(batches(fake)).toEqual([]);

    fake.answer.post = () => 204;
    fake.last().handlers.onError(false);
    fake.last().handlers.onOpen();
    await vi.advanceTimersByTimeAsync(0);

    expect(batches(fake).map((post) => post.message['lines'])).toEqual([lines('early')]);
  });

  it('stop leaving while the stream is down, and go on with the next hello', async () => {
    const { fake, client } = await linked();

    fake.last().handlers.onError(false);
    fake.logs.push('log', 'while away');
    client.logged();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(batches(fake)).toEqual([]);

    fake.last().handlers.onOpen();
    await vi.advanceTimersByTimeAsync(0);
    expect(batches(fake).map((post) => post.message['lines'])).toEqual([lines('while away')]);
  });

  it('count a refused batch in the dropped count of the next', async () => {
    const { fake, client } = await linked();
    let refuse = true;
    fake.answer.post = (type) => {
      if (type !== 'log' || !refuse) return 204;
      refuse = false;
      return 429;
    };

    fake.logs.push('log', 'a');
    fake.logs.push('log', 'a');
    client.logged();
    await vi.advanceTimersByTimeAsync(250);
    fake.logs.push('log', 'b');
    client.logged();
    await vi.advanceTimersByTimeAsync(250);

    expect(batches(fake).map((post) => post.message)).toEqual([
      {
        v: 1,
        device: DEVICE,
        launch: 'L1aunch0000a',
        lines: [{ level: 'log', text: 'a', count: 2 }],
        dropped: 0,
      },
      { v: 1, device: DEVICE, launch: 'L1aunch0000a', lines: lines('b'), dropped: 2 },
    ]);
  });

  it('send the same lines again on the same stream when a batch was lost on the way', async () => {
    const { fake, client } = await linked();
    let lose = true;
    fake.answer.post = (type) => {
      if (type !== 'log' || !lose) return 204;
      lose = false;
      return 0;
    };

    fake.logs.push('error', 'boom');
    client.logged();
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(250);

    const sent = batches(fake).map((post) => post.message['lines']);
    const boom = [{ level: 'error', text: 'boom', count: 1 }];
    expect(sent).toEqual([boom, boom]);
    expect(fake.streams).toHaveLength(1);
  });

  it('leave at once, in a request that outlives the page, when the page goes', async () => {
    const { fake, client } = await linked();
    fake.answer.post = (type) => (type === 'log' ? 'held' : 204);
    fake.logs.push('log', 'a');
    client.logged();
    await vi.advanceTimersByTimeAsync(250);

    fake.logs.push('error', 'last words');
    client.pageHidden();

    expect(batches(fake).at(-1)).toEqual({
      type: 'log',
      message: {
        v: 1,
        device: DEVICE,
        launch: 'L1aunch0000a',
        lines: [{ level: 'error', text: 'last words', count: 1 }],
        dropped: 0,
      },
      keepalive: true,
    });
  });

  it('still leave as the page restarts on a launch', async () => {
    const { fake, client } = await linked();

    fake.last().handlers.onMessage(message({ type: 'launch', launch: 'L2aunch0000b' }));
    fake.logs.push('warn', 'unloading');
    client.pageHidden();

    expect(fake.reload).toHaveBeenCalledOnce();
    // Named after the launch this page ran, not the one it restarts on: the
    // server, which runs the new one, drops it.
    expect(batches(fake)).toEqual([
      {
        type: 'log',
        message: {
          v: 1,
          device: DEVICE,
          launch: 'L1aunch0000a',
          lines: [{ level: 'warn', text: 'unloading', count: 1 }],
          dropped: 0,
        },
        keepalive: true,
      },
    ]);
  });

  it('never leave once told to reopen elsewhere', async () => {
    const { fake, client } = await linked();

    fake.last().handlers.onMessage(message({ type: 'reopen', transport: 'https' }));
    fake.logs.push('log', 'x');
    client.logged();
    client.pageHidden();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(batches(fake)).toEqual([]);
  });

  it('never leave once the link is gone', async () => {
    const { fake, client } = await linked();
    fake.answer.probe = 'gone';

    fake.last().handlers.onError(true);
    await vi.advanceTimersByTimeAsync(0);
    fake.logs.push('log', 'x');
    client.logged();
    client.pageHidden();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(fake.shown.at(-1)).toBe('gone');
    expect(batches(fake)).toEqual([]);
  });

  it('carry none of the client’s own lines', async () => {
    const { fake, client } = await linked();
    fake.logs.push('log', 'from the game');
    client.logged();
    fake.last().handlers.onError(false);
    fake.last().handlers.onOpen();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(fake.logged.length).toBeGreaterThan(0);
    const sent = JSON.stringify(batches(fake));
    for (const line of fake.logged) expect(sent).not.toContain(line);
    expect(sent).toContain('from the game');
  });
});
