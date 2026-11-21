import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixedId } from '@three-studio/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildScripts } from '../../../apps/desktop/src/main/scripts';
import { writeDynamicsProject } from '../generate/projects';
import { builtInRegistries } from '../registries';
import { metricsOf } from '../report/results';
import { DYNAMICS_METRICS, decodeDynamicsSubject, dynamicsMetrics } from '../scenarios/dynamics';

const registries = builtInRegistries();

/*
 * Scenario 4: a thousand scripted bodies at rest, a thousand Crates spawned and
 * destroyed through the running world, and a minute of churn. Its readings are
 * held here to the metrics they are read as, its subject to what a kept run
 * reads back, and its project's script to code Play builds.
 */

describe('scenario 4’s metrics', () => {
  it('judge the frames and the passes as timings and the heap after the churn as memory, and report the rest', () => {
    expect(Object.fromEntries([...DYNAMICS_METRICS].map(([name, spec]) => [name, spec.kind]))).toEqual({
      'scripted.frameMs': 'timing',
      'scripted.frameMsP95': 'reported',
      'scripted.frameMsMax': 'reported',
      'scripted.allocBytesPerFrame': 'reported',
      'spawn.ms': 'timing',
      'destroy.ms': 'timing',
      'churn.frameMs': 'timing',
      'churn.heapBytes': 'memory',
      'churn.heapGrowthBytes': 'reported',
    });
  });

  it('are made of a launch’s readings: every one the table declares, and nothing else', () => {
    const metrics = dynamicsMetrics({
      scripted: [4, 6, 5, 9, 5],
      allocBytesPerFrame: 3100,
      spawnMs: 210,
      destroyMs: 95,
      churn: [7, 8, 6],
      heapBefore: 400_000_000,
      heapAfter: 401_500_000,
    });

    expect(metrics).toEqual({
      'scripted.frameMs': 5,
      'scripted.frameMsP95': 9,
      'scripted.frameMsMax': 9,
      'scripted.allocBytesPerFrame': 3100,
      'spawn.ms': 210,
      'destroy.ms': 95,
      'churn.frameMs': 7,
      'churn.heapBytes': 401_500_000,
      'churn.heapGrowthBytes': 1_500_000,
    });
    expect(() => metricsOf(DYNAMICS_METRICS, [metrics])).not.toThrow();
  });
});

describe('scenario 4’s subject, kept between launches', () => {
  it('reads back the Crate prefab’s id, decoded as an asset id', () => {
    const subject = { project: '/tmp/Dynamics', crate: fixedId('asset', 'crate') };
    expect(decodeDynamicsSubject(JSON.parse(JSON.stringify(subject)))).toEqual(subject);
  });

  it('refuses one that names no prefab', () => {
    expect(() => decodeDynamicsSubject({ project: '/tmp/Dynamics', crate: '' })).toThrow(/"crate"/);
    expect(() => decodeDynamicsSubject({ project: '/tmp/Dynamics' })).toThrow(/"crate"/);
  });
});

describe('the dynamics project’s script', () => {
  let parent = '';
  beforeAll(async () => {
    parent = await mkdtemp(join(tmpdir(), 'perf-dynamics-'));
  });
  afterAll(async () => {
    await rm(parent, { recursive: true, force: true });
  });

  it('builds without an error, as Play builds it', async () => {
    const { path } = await writeDynamicsProject(parent, { boxes: 4, columns: 2 });
    const built = await buildScripts(registries, path, 'play');
    expect(built.errors).toEqual([]);
    expect(built.scriptCount).toBe(1);
  });
});
