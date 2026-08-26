import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASSETS_DIR, ASSET_META_SUFFIX, type ImportPlanItem } from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { scanAssets } from '../src/main/assets';
import { ImportSession } from '../src/main/import/ImportSession';

/*
 * The buffer, and what it promises: nothing reaches the project until the
 * import is confirmed, and what the renderer may read is decided here rather
 * than by whatever path it asks for.
 */

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studio-import-'));
  await mkdir(join(root, ASSETS_DIR), { recursive: true });
  return root;
}

async function sourceFolder(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studio-source-'));
  for (const [name, content] of Object.entries(files)) {
    const target = join(root, name);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
  return root;
}

/** Every file under `assets/`, so "nothing was written" can be asserted. */
async function assetFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(directory, entry.name), name);
      else found.push(name);
    }
  };
  await walk(join(root, ASSETS_DIR), '');
  return found.sort();
}

const planFor = (
  files: readonly { id: string; fileName: string; settings: unknown }[],
  folder = '',
): ImportPlanItem[] =>
  files.map((file) => ({
    fileId: file.id,
    folder,
    fileName: file.fileName,
    settings: file.settings as ImportPlanItem['settings'],
  }));

describe('an import session', () => {
  it('writes nothing to the project while it is open', async () => {
    const root = await project();
    const sources = await sourceFolder({ 'tree.fbx': 'geometry', 'brick.png': 'pixels' });

    const session = await ImportSession.open(
      root,
      [join(sources, 'tree.fbx'), join(sources, 'brick.png')],
      '',
    );

    expect(session.state().files).toHaveLength(2);
    // The whole point of the buffer: abandoning here, or crashing here, leaves
    // the project exactly as it was.
    expect(await assetFiles(root)).toEqual([]);
  });

  it('leaves nothing behind when it is abandoned', async () => {
    const root = await project();
    const sources = await sourceFolder({ 'tree.fbx': 'geometry' });
    await ImportSession.open(root, [join(sources, 'tree.fbx')], '');
    // Nothing to undo, because nothing was done — no staged copy, no temporary
    // directory, no half-written sidecar.
    expect(await assetFiles(root)).toEqual([]);
  });

  it('copies the file and its sidecar only once the import is confirmed', async () => {
    const root = await project();
    const sources = await sourceFolder({ 'tree.fbx': 'geometry' });
    const session = await ImportSession.open(root, [join(sources, 'tree.fbx')], '');

    const result = await session.commit(planFor(session.state().files as never[]));

    expect(result.imported).toHaveLength(1);
    expect(result.imported[0]).toMatchObject({ name: 'tree', kind: 'model', path: 'assets/models/tree.fbx' });
    expect(await assetFiles(root)).toEqual(['models/tree.fbx', `models/tree.fbx${ASSET_META_SUFFIX}`]);

    // And the settings the dialog decided are what landed on disk.
    const meta = JSON.parse(
      await readFile(join(root, ASSETS_DIR, 'models', `tree.fbx${ASSET_META_SUFFIX}`), 'utf8'),
    ) as { settings: { format: string } };
    expect(meta.settings.format).toBe('fbx');
  });

  it('honours the folder the plan names, not the importer default', async () => {
    const root = await project();
    const sources = await sourceFolder({ 'brick.png': 'pixels' });
    const session = await ImportSession.open(root, [join(sources, 'brick.png')], 'props/walls');

    await session.commit(planFor(session.state().files as never[], 'props/walls'));
    expect(await assetFiles(root)).toContain('props/walls/brick.png');
  });

  it('writes what the author changed rather than what was staged', async () => {
    const root = await project();
    const sources = await sourceFolder({ 'tree.fbx': 'geometry' });
    const session = await ImportSession.open(root, [join(sources, 'tree.fbx')], '');
    const staged = session.state().files[0]!;

    await session.commit([
      {
        fileId: staged.id,
        folder: '',
        fileName: staged.fileName,
        // The dialog's whole reason for being: Unreal's centimetres, corrected
        // before the asset exists rather than after it is in a scene.
        settings: { ...staged.settings!, scale: 0.01 } as never,
      },
    ]);

    const asset = (await scanAssets(root)).assets[0]!;
    expect(asset.settings).toMatchObject({ kind: 'model', scale: 0.01 });
  });

  it('walks a dropped folder and skips what nothing imports', async () => {
    const root = await project();
    const sources = await sourceFolder({
      'tree.fbx': 'geometry',
      'notes.txt': 'nothing',
      '.DS_Store': 'junk',
      'nested/rock.obj': 'o rock\n',
    });

    const session = await ImportSession.open(root, [sources], '');
    expect(session.state().files.map((file) => file.fileName).sort()).toEqual([
      'rock.obj',
      'tree.fbx',
    ]);
  });

  it('says so when a file is named outright and nothing can import it', async () => {
    // Named, not swept up by a folder walk: the author meant this file, so the
    // answer is a row explaining why rather than a silent omission.
    const root = await project();
    const sources = await sourceFolder({ 'notes.txt': 'nothing' });
    const session = await ImportSession.open(root, [join(sources, 'notes.txt')], '');

    expect(session.state().files[0]).toMatchObject({
      fileName: 'notes.txt',
      importerId: null,
      kind: null,
      settings: null,
    });
  });

  it('reports the bytes the project already has, without refusing them', async () => {
    const root = await project();
    const first = await sourceFolder({ 'tree.fbx': 'geometry' });
    const opening = await ImportSession.open(root, [join(first, 'tree.fbx')], '');
    await opening.commit(planFor(opening.state().files as never[]));

    const again = await sourceFolder({ 'copy-of-tree.fbx': 'geometry' });
    const session = await ImportSession.open(root, [join(again, 'copy-of-tree.fbx')], '');

    expect(session.state().files[0]?.conflict).toMatchObject({
      kind: 'duplicate',
      existingPath: 'assets/models/tree.fbx',
    });
  });

  it('reports a name already taken separately from identical bytes', async () => {
    const root = await project();
    const first = await sourceFolder({ 'tree.fbx': 'geometry' });
    const opening = await ImportSession.open(root, [join(first, 'tree.fbx')], '');
    await opening.commit(planFor(opening.state().files as never[]));

    const other = await sourceFolder({ 'tree.fbx': 'a different tree entirely' });
    const session = await ImportSession.open(root, [join(other, 'tree.fbx')], '');

    expect(session.state().files[0]?.conflict).toMatchObject({
      kind: 'name',
      existingPath: 'assets/models/tree.fbx',
    });
  });

  it('never overwrites the file already there', async () => {
    const root = await project();
    const first = await sourceFolder({ 'tree.fbx': 'geometry' });
    const opening = await ImportSession.open(root, [join(first, 'tree.fbx')], '');
    await opening.commit(planFor(opening.state().files as never[]));

    const other = await sourceFolder({ 'tree.fbx': 'a different tree entirely' });
    const session = await ImportSession.open(root, [join(other, 'tree.fbx')], '');
    await session.commit(planFor(session.state().files as never[]));

    expect(await assetFiles(root)).toContain('models/tree-1.fbx');
    expect(await readFile(join(root, ASSETS_DIR, 'models', 'tree.fbx'), 'utf8')).toBe('geometry');
  });

  it("brings a model's side files with it, into a folder of their own", async () => {
    const root = await project();
    const sources = await sourceFolder({
      'tree.obj': 'mtllib tree.mtl\n',
      'tree.mtl': 'map_Kd bark.png\n',
      'bark.png': 'pixels',
    });
    const session = await ImportSession.open(root, [join(sources, 'tree.obj')], '');
    const staged = session.state().files[0]!;
    expect([...staged.companions].sort()).toEqual(['bark.png', 'tree.mtl']);

    await session.commit(planFor([staged] as never[]));
    // A folder of its own, because the names come from inside the model: two
    // such imports side by side would otherwise overwrite each other's parts.
    expect(await assetFiles(root)).toEqual(
      expect.arrayContaining([
        'models/tree/tree.obj',
        'models/tree/tree.mtl',
        'models/tree/bark.png',
      ]),
    );
  });
});

describe('what a preview may read', () => {
  it('serves the staged file and the side files read out of it', async () => {
    const root = await project();
    const sources = await sourceFolder({
      'tree.obj': 'mtllib tree.mtl\n',
      'tree.mtl': 'map_Kd bark.png\n',
      'bark.png': 'pixels',
    });
    const session = await ImportSession.open(root, [join(sources, 'tree.obj')], '');
    const staged = session.state().files[0]!;

    expect(session.resolvePreview(staged.id, 'tree.obj')).toBe(join(sources, 'tree.obj'));
    expect(session.resolvePreview(staged.id, 'bark.png')).toBe(join(sources, 'bark.png'));
  });

  it('refuses a path the session never staged', async () => {
    // Without this the scheme would be an arbitrary read of the whole machine,
    // reachable from anything running in the renderer.
    const root = await project();
    const sources = await sourceFolder({ 'tree.obj': 'o tree\n', 'secret.txt': 'private' });
    const session = await ImportSession.open(root, [join(sources, 'tree.obj')], '');
    const staged = session.state().files[0]!;

    // In the same folder, and still not ours to serve.
    expect(session.resolvePreview(staged.id, 'secret.txt')).toBeNull();
    expect(session.resolvePreview(staged.id, '../../../etc/passwd')).toBeNull();
    expect(session.resolvePreview('not-a-file-id', 'tree.obj')).toBeNull();
  });
});
