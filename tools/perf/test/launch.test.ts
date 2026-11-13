import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chromeCommand } from '../launch/chrome';
import { editorCommand, type EditorLaunch } from '../launch/electron';

/*
 * What the editor and Chrome are started with, read without starting them.
 * The arguments are where the harness's isolation lives: its own application
 * data, its own profile, windows that keep drawing behind others.
 */

const launch = (mode: EditorLaunch['mode']): EditorLaunch => ({
  repo: '/repo',
  runDir: '/scratch/run-1',
  project: '/scratch/run-1/projects/Render',
  mode,
  label: 'S3-1',
  port: 9555,
});

describe('an editor launch', () => {
  it('runs the desktop app on the Electron binary it is given', () => {
    const command = editorCommand(launch('display'), '/repo/node_modules/electron/dist/Electron');
    expect(command.command).toBe('/repo/node_modules/electron/dist/Electron');
    expect(command.args[0]).toBe(join('/repo', 'apps/desktop'));
  });

  it('keeps its application data inside the run folder', () => {
    const { args } = editorCommand(launch('display'), 'electron');
    expect(args).toContain('--user-data-dir=/scratch/run-1/user-data');
    expect(args).toContain('--remote-debugging-port=9555');
  });

  it('frees the frame from the display only when uncapped', () => {
    const uncapped = ['--disable-frame-rate-limit', '--disable-gpu-vsync'];
    expect(editorCommand(launch('uncapped'), 'electron').args).toEqual(expect.arrayContaining(uncapped));
    for (const flag of uncapped) expect(editorCommand(launch('display'), 'electron').args).not.toContain(flag);
  });

  it('goes on drawing when covered, in both modes', () => {
    for (const mode of ['display', 'uncapped'] as const) {
      expect(editorCommand(launch(mode), 'electron').args).toContain('--disable-backgrounding-occluded-windows');
    }
  });

  it('opens the project under the smoke harness, with nothing inherited that would steer it', () => {
    const before = process.env['STUDIO_SMOKE_SHOT'];
    process.env['STUDIO_SMOKE_SHOT'] = '/somewhere/shot.png';
    try {
      const { env } = editorCommand(launch('display'), 'electron');
      expect(env).toMatchObject({
        STUDIO_SMOKE: '1',
        STUDIO_SMOKE_PROJECT: '/scratch/run-1/projects/Render',
        STUDIO_SMOKE_SETTLE: '0',
      });
      expect(env['STUDIO_SMOKE_SETUP']).toContain('__perfDone');
      expect(env['STUDIO_SMOKE_SHOT']).toBeUndefined();
      expect(env['VITEST']).toBeUndefined();
    } finally {
      if (before === undefined) delete process.env['STUDIO_SMOKE_SHOT'];
      else process.env['STUDIO_SMOKE_SHOT'] = before;
    }
  });
});

describe('a Chrome launch', () => {
  it('opens a fresh profile behind the person’s work, with nothing throttled', () => {
    const { command, args } = chromeCommand('/scratch/run-1/chrome-1', 9666, '/scratch/run-1/logs/chrome-1.log');
    expect(command).toBe('open');
    expect(args.slice(0, 4)).toEqual(['-g', '-n', '-a', 'Google Chrome']);
    // Its output kept, since `open` drops it: the one place Chrome says why it did not listen.
    expect(args.slice(4, 9)).toEqual([
      '--stdout',
      '/scratch/run-1/logs/chrome-1.log',
      '--stderr',
      '/scratch/run-1/logs/chrome-1.log',
      '--args',
    ]);
    expect(args).toEqual(
      expect.arrayContaining([
        '--user-data-dir=/scratch/run-1/chrome-1',
        '--remote-debugging-port=9666',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
      ]),
    );
    expect(args.at(-1)).toBe('about:blank');
  });
});
