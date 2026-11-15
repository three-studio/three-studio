import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordAt, stringAt } from '../launch/cdp';
import { prepared, type ScenarioContext } from '../scenarios/context';

/*
 * An A/B runs each tree one launch at a time; each tree must prepare its
 * projects — write them, warm them — once, not once per launch.
 */

describe('a scenario’s prepared subject', () => {
  let runDir = '';
  beforeAll(async () => {
    runDir = await mkdtemp(join(tmpdir(), 'perf-prepared-'));
  });
  afterAll(async () => {
    await rm(runDir, { recursive: true, force: true });
  });

  const context = (keep: boolean): ScenarioContext => ({ repo: '/repo', runDir, launches: 1, shots: null, keep, say: () => {} });
  const decode = (value: unknown): { project: string } => {
    if (typeof value !== 'object' || value === null) throw new Error('not a subject');
    return { project: stringAt(recordAt({ value }, 'value'), 'project') };
  };

  it('is made once and read back when the run keeps its folder', async () => {
    let made = 0;
    const make = async (folder: string) => {
      made += 1;
      return { project: join(folder, 'Render') };
    };
    const first = await prepared(context(true), 'S3', make, decode);
    const second = await prepared(context(true), 'S3', make, decode);
    expect(second).toEqual(first);
    expect(made).toBe(1);
  });

  it('is made again when the run does not keep it', async () => {
    let made = 0;
    const make = async (folder: string) => {
      made += 1;
      return { project: join(folder, 'Large') };
    };
    await prepared(context(false), 'S2', make, decode);
    await prepared(context(false), 'S2', make, decode);
    expect(made).toBe(2);
  });

  it('is made again when what was kept does not read back', async () => {
    let made = 0;
    const make = async (folder: string) => {
      made += 1;
      return made === 1 ? { wrong: folder } : { project: folder };
    };
    await prepared(context(true), 'S5', make, () => {
      throw new Error('another harness wrote this');
    });
    await prepared(context(true), 'S5', make, decode);
    expect(made).toBe(2);
  });
});
