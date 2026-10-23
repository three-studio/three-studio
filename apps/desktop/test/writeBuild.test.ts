import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BuildPlan } from '../src/main/build/buildPlan';
import { BUILD_ROOTS } from '../src/main/build/outputFolder';
import { writeBuild } from '../src/main/build/writeBuild';

/*
 * Every file of a game but the page and the manifest is named by its content,
 * so writing the next build lands beside the previous one rather than over it.
 * The page and the manifest go last: until they do, the folder serves the
 * previous build, whole — which is what a failure half way through has to
 * leave behind.
 */
describe('writing a build', () => {
  async function previousBuild(): Promise<{ root: string; outputDir: string }> {
    const root = await mkdtemp(join(tmpdir(), 'studio-write-'));
    const outputDir = join(root, 'out');
    await mkdir(join(outputDir, 'game', 'assets'), { recursive: true });
    await writeFile(join(outputDir, 'index.html'), 'previous page', 'utf8');
    await writeFile(join(outputDir, 'game', 'build.json'), '{"previous":true}', 'utf8');
    await writeFile(join(outputDir, 'game', 'assets', 'stone.11111111.png'), 'previous', 'utf8');
    await writeFile(join(outputDir, 'files.json'), 'previous list', 'utf8');
    return { root, outputDir };
  }

  it('leaves the previous build whole when a write fails before the switch', async () => {
    const { root, outputDir } = await previousBuild();
    const plan = new BuildPlan(new Set(BUILD_ROOTS));
    plan.addBytes('index.html', 'next page', { kind: 'page' });
    plan.addBytes('game/build.json', '{"next":true}', { kind: 'manifest' });
    plan.addBytes('game/assets/brick.22222222.png', 'next', {
      kind: 'asset',
      assetId: 'brick',
      assetKind: 'texture',
    });
    // A source that went between planning and writing: a volume unplugged, a
    // file deleted in the Finder.
    plan.add(
      'game/assets/wood.33333333.png',
      { kind: 'file', path: join(root, 'gone.png') },
      { kind: 'asset', assetId: 'wood', assetKind: 'texture' },
      { bytes: 1, sha256: 'a'.repeat(64) },
    );

    await expect(writeBuild(plan, outputDir, BUILD_ROOTS)).rejects.toThrow();

    expect(await readFile(join(outputDir, 'index.html'), 'utf8')).toBe('previous page');
    expect(await readFile(join(outputDir, 'game', 'build.json'), 'utf8')).toBe('{"previous":true}');
    expect(await readFile(join(outputDir, 'files.json'), 'utf8')).toBe('previous list');
    // Nothing taken back either: the previous manifest still names this.
    expect(await readdir(join(outputDir, 'game', 'assets'))).toContain('stone.11111111.png');
  });

  it('switches, then takes back what the previous build held', async () => {
    const { outputDir } = await previousBuild();
    const plan = new BuildPlan(new Set(BUILD_ROOTS));
    plan.addBytes('index.html', 'next page', { kind: 'page' });
    plan.addBytes('game/build.json', '{"next":true}', { kind: 'manifest' });
    plan.addBytes('game/assets/brick.22222222.png', 'next', {
      kind: 'asset',
      assetId: 'brick',
      assetKind: 'texture',
    });

    await writeBuild(plan, outputDir, BUILD_ROOTS);

    expect(await readFile(join(outputDir, 'index.html'), 'utf8')).toBe('next page');
    expect(await readdir(join(outputDir, 'game', 'assets'))).toEqual(['brick.22222222.png']);
    const list = JSON.parse(await readFile(join(outputDir, 'files.json'), 'utf8')) as {
      files: { path: string }[];
    };
    expect(list.files.map((file) => file.path)).toEqual([
      'game/assets/brick.22222222.png',
      'game/build.json',
      'index.html',
    ]);
  });
});
