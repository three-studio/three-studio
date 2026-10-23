import { mkdir, mkdtemp, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claimOutputFolder, outputFolderProblem } from '../src/main/build/outputFolder';

/*
 * The output folder is chosen in a file picker, and nothing stood between the
 * choice and the first `rm`: choosing the project emptied its own `assets/`
 * and `scenes/`, and choosing a site that had an `assets/` emptied that.
 */

/** A home folder with a project in it, both in a temporary directory. */
async function setUp(): Promise<{ root: string; home: string; projectPath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'studio-output-'));
  const home = join(root, 'home');
  const projectPath = join(home, 'Game');
  await mkdir(join(projectPath, 'assets'), { recursive: true });
  await mkdir(join(projectPath, 'scenes'), { recursive: true });
  return { root, home, projectPath };
}

/** What an export of the current layout writes at the top of its folder. */
const OWNED = [
  '_studio',
  'favicon.svg',
  'index.html',
  'assets',
  'scenes',
  'scripts.mjs',
  'build.json',
  'files.json',
];

describe('where an export may write', () => {
  it('refuses the project itself, however it is spelled', async () => {
    const { home, projectPath } = await setUp();
    expect(await outputFolderProblem(projectPath, projectPath, home)).toMatch(/project itself/);
    expect(await outputFolderProblem(join(projectPath, 'scenes', '..'), projectPath, home)).toMatch(
      /project itself/,
    );
    // A path is not an answer to "is this the project": a link names it too.
    const link = join(home, 'shortcut');
    await symlink(projectPath, link);
    expect(await outputFolderProblem(link, projectPath, home)).toMatch(/project itself/);
  });

  it("refuses the project's assets/ and scenes/, and folders inside them that do not exist yet", async () => {
    const { home, projectPath } = await setUp();
    expect(await outputFolderProblem(join(projectPath, 'assets', 'build'), projectPath, home)).toMatch(
      /assets\//,
    );
    expect(await outputFolderProblem(join(projectPath, 'scenes'), projectPath, home)).toMatch(
      /scenes\//,
    );
  });

  it('accepts a folder of its own inside the project, as Unity keeps Builds/', async () => {
    const { home, projectPath } = await setUp();
    expect(await outputFolderProblem(join(projectPath, 'Builds', 'web'), projectPath, home)).toBeNull();
  });

  it('refuses the home folder and the top of a disk', async () => {
    const { home, projectPath } = await setUp();
    expect(await outputFolderProblem(home, projectPath, home)).toMatch(/home folder/);
    expect(await outputFolderProblem(parse(tmpdir()).root, projectPath, home)).toMatch(/top of a disk/);
  });
});

describe('what an export may replace', () => {
  it("refuses a folder holding another tool's index.html and Assets/, and leaves it as it was", async () => {
    const { root, home, projectPath } = await setUp();
    const site = join(root, 'site');
    // `Assets` rather than `assets`: the volumes this runs on mostly ignore
    // case, so it is the folder an export writing `assets/` would empty.
    await mkdir(join(site, 'Assets'), { recursive: true });
    await writeFile(join(site, 'index.html'), '<h1>My site</h1>', 'utf8');

    await expect(claimOutputFolder(site, projectPath, OWNED, home)).rejects.toThrow(
      /Assets, index\.html/,
    );
    expect((await readdir(site)).sort()).toEqual(['Assets', 'index.html']);
  });

  it("accepts a repository's own files, which an export never touches", async () => {
    const { root, home, projectPath } = await setUp();
    const repository = join(root, 'repository');
    await mkdir(join(repository, '.git'), { recursive: true });
    await writeFile(join(repository, 'README.md'), '# Demo', 'utf8');

    const release = await claimOutputFolder(repository, projectPath, OWNED, home);
    release();
  });

  it('accepts a folder an export already filled', async () => {
    const { root, home, projectPath } = await setUp();
    const build = join(root, 'build');
    await mkdir(join(build, 'assets'), { recursive: true });
    await writeFile(join(build, 'index.html'), '<!doctype html>', 'utf8');
    await writeFile(join(build, 'build.json'), JSON.stringify({ formatVersion: 6 }), 'utf8');

    const release = await claimOutputFolder(build, projectPath, OWNED, home);
    release();
  });

  it('holds a folder for one export at a time', async () => {
    const { root, home, projectPath } = await setUp();
    const out = join(root, 'out');

    const release = await claimOutputFolder(out, projectPath, OWNED, home);
    await expect(claimOutputFolder(out, projectPath, OWNED, home)).rejects.toThrow(/already running/);
    release();
    (await claimOutputFolder(out, projectPath, OWNED, home))();
  });

  it('creates nothing when it refuses', async () => {
    const { home, projectPath } = await setUp();
    await expect(
      claimOutputFolder(join(projectPath, 'assets', 'build'), projectPath, OWNED, home),
    ).rejects.toThrow();
    expect(await readdir(join(projectPath, 'assets'))).toEqual([]);
  });
});
