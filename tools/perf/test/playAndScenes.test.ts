import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildScripts } from '../../../apps/desktop/src/main/scripts';
import { readProject } from '../../../apps/desktop/src/main/project';
import { ballastPaths, writeScriptedProject, type ScriptedRecipe } from '../generate/projects';
import { builtInRegistries } from '../registries';
import { METRICS, editBallast, loadingMetrics } from '../scenarios/playAndScenes';

const registries = builtInRegistries();

/*
 * The scripted project's scripts are code a person could have written: they
 * build with the app's own `buildScripts`, as Play builds them. An edit to a
 * ballast script changes the bundle, which is what makes each edit → Play
 * cycle import one more.
 */

describe('the scripted project', () => {
  const recipe: ScriptedRecipe = {
    props: 10,
    ballast: 3,
    heavy: { props: 20, columns: 5 },
    heavyImages: { primitives: 1, imageSide: 64 },
  };
  let parent = '';
  let project = '';
  beforeAll(async () => {
    parent = await mkdtemp(join(tmpdir(), 'perf-scripted-'));
    project = await writeScriptedProject(parent, recipe);
  });
  afterAll(async () => {
    await rm(parent, { recursive: true, force: true });
  });

  it('builds every script without an error, and sets no loading scene', async () => {
    const built = await buildScripts(registries, project, 'play');
    expect(built.errors).toEqual([]);
    expect(built.scriptCount).toBe(2 + recipe.ballast);
    expect((await readProject(project)).settings.loadingScene).toBeNull();
  });

  it('changes the bundle at each ballast edit', async () => {
    const [ballast] = ballastPaths(recipe);
    if (ballast === undefined) throw new Error('no ballast script');
    const before = (await buildScripts(registries, project, 'play')).code;
    await editBallast(join(project, ballast), 1);
    expect(await readFile(join(project, ballast), 'utf8')).toContain('const REVISION = 1;');
    const after = (await buildScripts(registries, project, 'play')).code;
    expect(after).not.toBe(before);
    await editBallast(join(project, ballast), 2);
    expect((await buildScripts(registries, project, 'play')).code).not.toBe(after);
  });
});

describe("scenario 6's loading switch", () => {
  it("reads the programs the target's first frame created, as a reported count", () => {
    const metrics = loadingMetrics({ ms: 900, longestFrameMs: 120, frames: 17, startPrograms: 4, sawLoading: 1 });
    expect(metrics['loading.startPrograms']).toBe(4);
    expect(Number.isNaN(loadingMetrics({})['loading.startPrograms'])).toBe(true);
    expect(METRICS.get('loading.startPrograms')).toEqual({ kind: 'reported', unit: '' });
  });
});
