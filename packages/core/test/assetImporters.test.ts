import { describe, expect, it } from 'vitest';
import {
  assetDisplayName,
  assetKindForFile,
  assetKindInfo,
  defaultSettings,
  importerForFile,
  importPreviewUrl,
  parseImportPreviewUrl,
} from '../src/assets/import';
import type { TextReader } from '../src/assets/import';
import { GltfImporter } from '../src/assets/import/importers/GltfImporter';
import { assertDefined } from '../src/assert';
import type { FieldGroup } from '../src/fields';
import { fixedId } from '../src/ids';
import type { StagedFile } from '../src/assets/import';
import type {
  FbxModelSettings,
  ObjModelSettings,
  TextureSettings,
} from '../src/assets/schema';
import { activateCore } from '../src/activate';
import { createCoreRegistries } from '../src/registries';
import { builtInRegistries } from './registries';

const registries = builtInRegistries();
/** The directory and extensions of one kind, which every built-in kind has. */
const kindInfo = (kind: Parameters<typeof defaultSettings>[1]) =>
  assertDefined(assetKindInfo(registries).get(kind), `the ${kind} kind`);

/** A filesystem that is a map, which is the whole point of injecting the reader. */
const reading = (files: Record<string, string>): TextReader => {
  return async (path) => files[path] ?? null;
};

const groupLabels = (fields: readonly { type: string }[]): string[] =>
  fields.filter((f): f is FieldGroup => f.type === 'group').map((group) => group.label);

describe('the importer registry', () => {
  it('picks an importer per format, not per kind', () => {
    expect(importerForFile(registries, 'tree.fbx')?.id).toBe('model.fbx');
    expect(importerForFile(registries, 'tree.glb')?.id).toBe('model.gltf');
    expect(importerForFile(registries, 'tree.gltf')?.id).toBe('model.gltf');
    expect(importerForFile(registries, 'tree.obj')?.id).toBe('model.obj');
    expect(importerForFile(registries, 'brick.PNG')?.id).toBe('texture');
    expect(importerForFile(registries, 'step.wav')?.id).toBe('audio');
  });

  it('resolves the extensions that overlap by order rather than by luck', () => {
    // `.prefab.json`, `.material.json` and a bare `.json` are all `.json`, and
    // `.material.ts` is also `.ts`. Registration order is the whole answer.
    expect(assetKindForFile(registries, 'Rock.prefab.json')).toBe('prefab');
    expect(assetKindForFile(registries, 'Stone.material.json')).toBe('material');
    expect(assetKindForFile(registries, 'Holo.material.ts')).toBe('material');
    expect(assetKindForFile(registries, 'Rotator.ts')).toBe('script');
  });

  it('keeps a bare .json landing on material, as every stored sidecar assumes', () => {
    // Reclassifying one would orphan its sidecar on the next scan, and the
    // scan deletes orphan sidecars: the id, and every scene reference to it,
    // would go with it.
    expect(assetKindForFile(registries, 'legacy.json')).toBe('material');
  });

  it('a physics material is a kind of its own, and every other .json is still a material', () => {
    expect(assetKindForFile(registries, 'Ice.physics-material.json')).toBe('physicsMaterial');
    expect(assetKindForFile(registries, 'Stone.material.json')).toBe('material');
    expect(assetKindForFile(registries, 'legacy.json')).toBe('material');

    expect(assetDisplayName(registries, 'Ice.physics-material.json')).toBe('Ice');
    expect(kindInfo('physicsMaterial').directory).toBe('physics-materials');
    expect(defaultSettings(registries, 'physicsMaterial')).toEqual({ kind: 'physicsMaterial' });
  });

  it('takes nothing it has no importer for, sidecars included', () => {
    expect(assetKindForFile(registries, 'tree.glb.meta.json')).toBeUndefined();
    expect(assetKindForFile(registries, 'notes.txt')).toBeUndefined();
    expect(assetKindForFile(registries, 'README')).toBeUndefined();
  });

  it('derives the kind table from the importers themselves', () => {
    expect(kindInfo('model').directory).toBe('models');
    expect(kindInfo('model').extensions).toEqual(expect.arrayContaining(['glb', 'gltf', 'fbx', 'obj']));
    // Claimed only as `.prefab.json`, but a file dialog still needs `json`.
    expect(kindInfo('prefab').extensions).toContain('json');
  });

  it('lists the kinds in the order their first importer is registered', () => {
    expect([...assetKindInfo(registries).keys()]).toEqual([
      'prefab',
      'physicsMaterial',
      'material',
      'script',
      'model',
      'texture',
      'audio',
      'shader',
    ]);
  });

  /*
   * Nothing registers by being imported: a format is known to the registries a
   * root activated, and to no others — and those refuse a second importer under
   * an id they hold, keeping the first.
   */
  it('knows no format in registries nobody activated', () => {
    const empty = createCoreRegistries();
    expect(importerForFile(empty, 'tree.glb')).toBeUndefined();
    expect(assetKindInfo(empty).size).toBe(0);
    expect(() => defaultSettings(empty, 'model')).toThrow(/No importer registered/);
  });

  it('refuses a second importer under an id it holds, and keeps the first', () => {
    const own = createCoreRegistries();
    activateCore(own);
    const first = importerForFile(own, 'tree.glb');

    expect(() => own.importers.register(new GltfImporter())).toThrow('The importer "model.gltf" is already registered.');
    expect(importerForFile(own, 'tree.glb')).toBe(first);
  });

  it('strips a whole compound extension from a display name', () => {
    expect(assetDisplayName(registries, 'Stone.material.json')).toBe('Stone');
    expect(assetDisplayName(registries, 'Rock.prefab.json')).toBe('Rock');
    expect(assetDisplayName(registries, 'tree.glb')).toBe('tree');
    expect(assetDisplayName(registries, 'README')).toBe('README');
  });
});

describe('per-format defaults', () => {
  it('gives each model format the shared trunk plus its own', () => {
    const fbx = defaultSettings(registries, 'model', 'tree.fbx') as FbxModelSettings;
    expect(fbx).toMatchObject({
      kind: 'model',
      format: 'fbx',
      scale: 1,
      upAxis: 'y',
      importMaterials: true,
      importAnimations: true,
      generateColliders: false,
      collisionMeshes: 'ignore',
    });

    const obj = defaultSettings(registries, 'model', 'tree.obj') as ObjModelSettings;
    expect(obj).toMatchObject({ format: 'obj', computeNormals: true });
    expect(obj).not.toHaveProperty('collisionMeshes');

    expect(defaultSettings(registries, 'model', 'tree.gltf')).toMatchObject({
      format: 'gltf',
      importCameras: false,
      importLights: false,
    });
  });

  it('falls back to the first importer of the kind when there is no file name', () => {
    // What a sidecar upgrade hits when it knows the kind and nothing else.
    expect(defaultSettings(registries, 'model')).toMatchObject({ kind: 'model', format: 'gltf' });
  });

  it('lets the stored kind win over what the name suggests', () => {
    // An author who retagged a file did so deliberately; the migration must not
    // undo it on the next read.
    expect(defaultSettings(registries, 'texture', 'weird.fbx')).toMatchObject({ kind: 'texture' });
  });

  it('reads what a texture name can say about how it stores light', () => {
    expect(defaultSettings(registries, 'texture', 'sky.hdr')).toMatchObject({ encoding: 'hdr' });
    expect(defaultSettings(registries, 'texture', 'sky.exr')).toMatchObject({ encoding: 'hdr' });
    expect(defaultSettings(registries, 'texture', 'brick.png')).toMatchObject({ encoding: 'sdr' });
  });

  it('gives every registered importer defaults of the kind it claims', () => {
    for (const importer of registries.importers.values()) {
      expect(importer.defaultSettings(`x.${importer.extensions[0] ?? 'json'}`).kind).toBe(
        importer.kind,
      );
    }
  });
});

describe('declared fields', () => {
  it('puts the shared trunk above the format that adds to it', () => {
    const fbx = importerForFile(registries, 'tree.fbx')!;
    expect(groupLabels(fbx.fields(fbx.defaultSettings('tree.fbx')))).toEqual(['Model', 'FBX']);

    const gltf = importerForFile(registries, 'tree.glb')!;
    expect(groupLabels(gltf.fields(gltf.defaultSettings('tree.glb')))).toEqual(['Model', 'glTF']);
  });

  it('drops a row whose setting cannot apply', () => {
    const texture = importerForFile(registries, 'brick.png')!;
    const base = texture.defaultSettings('brick.png') as TextureSettings;

    const withMipmaps = texture.fields(base) as readonly FieldGroup[];
    expect(JSON.stringify(withMipmaps)).toContain('anisotropy');

    const without = texture.fields({ ...base, generateMipmaps: false });
    expect(JSON.stringify(without)).not.toContain('anisotropy');
  });

  it('asks nothing for the formats that decide nothing', () => {
    expect(importerForFile(registries, 'Rotator.ts')!.fields({ kind: 'script' })).toEqual([]);
    expect(importerForFile(registries, 'Rock.prefab.json')!.fields({ kind: 'prefab' })).toEqual([]);
  });
});

describe('companion files', () => {
  it("reads a glTF's own buffers and images rather than guessing them", async () => {
    const gltf = importerForFile(registries, 'tree.gltf')!;
    const read = reading({
      'tree.gltf': JSON.stringify({
        buffers: [{ uri: 'tree.bin' }, { uri: 'data:application/octet-stream;base64,AA==' }],
        images: [{ uri: 'textures/bark%20a.png' }, { uri: 'https://example.com/leaf.png' }],
      }),
    });

    const found = await gltf.companions('tree.gltf', read);
    // Decoded, so the copy uses the name the filesystem actually has.
    expect([...found].sort()).toEqual(['textures/bark a.png', 'tree.bin']);
  });

  it('brings nothing along for the formats that pack everything in', async () => {
    const read = reading({});
    expect(await importerForFile(registries, 'tree.glb')!.companions('tree.glb', read)).toEqual([]);
    expect(await importerForFile(registries, 'tree.fbx')!.companions('tree.fbx', read)).toEqual([]);
  });

  it('follows an OBJ into its material library and out to the maps', async () => {
    const obj = importerForFile(registries, 'tree.obj')!;
    const read = reading({
      'tree.obj': 'mtllib mats/tree.mtl\nv 0 0 0\n',
      // Relative to the library, not to the model that names it.
      'mats/tree.mtl': 'newmtl bark\nmap_Kd -s 1 1 1 bark.png\nbump normal.png\n',
    });

    expect([...(await obj.companions('tree.obj', read))].sort()).toEqual([
      'mats/bark.png',
      'mats/normal.png',
      'mats/tree.mtl',
    ]);
  });

  it('imports an OBJ whose library was named but never shipped', async () => {
    const obj = importerForFile(registries, 'tree.obj')!;
    const read = reading({ 'tree.obj': 'mtllib missing.mtl\n' });
    expect(await obj.companions('tree.obj', read)).toEqual(['missing.mtl']);
  });

  it('refuses a reference that would reach outside the folder it came from', async () => {
    const gltf = importerForFile(registries, 'tree.gltf')!;
    const read = reading({
      'tree.gltf': JSON.stringify({
        buffers: [{ uri: '../../../etc/passwd' }, { uri: '/absolute.bin' }, { uri: '  ' }],
      }),
    });
    expect(await gltf.companions('tree.gltf', read)).toEqual([]);
  });

  it('refuses a reference that only reaches outside once it is decoded', async () => {
    // `%2e%2e` is two dots as a URI spells them. The check used to read the
    // text as written and decode it afterwards, so this passed as an ordinary
    // name and came out of the set as `../` — and every caller joins what comes
    // out onto a folder.
    const gltf = importerForFile(registries, 'tree.gltf')!;
    const read = reading({
      'tree.gltf': JSON.stringify({
        buffers: [
          { uri: '%2e%2e/%2e%2e/.ssh/id_rsa' },
          { uri: 'textures/..%2f..%2fsecret.png' },
          { uri: '%5c..%5csecret.bin' },
          { uri: '%2fabsolute.bin' },
          { uri: 'C:\\textures\\bark.png' },
          { uri: 'C%3A%5Ctextures%5Cbark.png' },
          { uri: 'blob:https://example.com/1234' },
          { uri: 'tree%00.bin' },
        ],
      }),
    });
    expect(await gltf.companions('tree.gltf', read)).toEqual([]);
  });

  it('skips a reference that does not decode, and keeps the ones after it', async () => {
    const gltf = importerForFile(registries, 'tree.gltf')!;
    const read = reading({
      'tree.gltf': JSON.stringify({ images: [{ uri: '100%.png' }, { uri: 'bark.png' }] }),
    });
    expect(await gltf.companions('tree.gltf', read)).toEqual(['bark.png']);

    // An OBJ used to throw outright, which failed whatever had asked: an import,
    // a move, an export.
    const obj = importerForFile(registries, 'tree.obj')!;
    expect(await obj.companions('tree.obj', reading({ 'tree.obj': 'mtllib 100%.mtl\n' }))).toEqual(
      [],
    );
  });

  it('reads the paths exporters actually write', async () => {
    const gltf = importerForFile(registries, 'tree.gltf')!;
    const read = reading({
      'tree.gltf': JSON.stringify({
        // A sibling named the explicit way, a doubled slash, and two dots inside
        // a name, which is a name and not a step up.
        buffers: [{ uri: './tree.bin' }, { uri: 'maps//bark.png' }, { uri: 'leaf..final.png' }],
      }),
    });
    expect([...(await gltf.companions('tree.gltf', read))].sort()).toEqual([
      'leaf..final.png',
      'maps/bark.png',
      'tree.bin',
    ]);

    // Windows separators, in the library name and in the maps it lists.
    const obj = importerForFile(registries, 'tree.obj')!;
    const objRead = reading({
      'tree.obj': 'mtllib mats\\tree.mtl\n',
      'mats/tree.mtl': 'newmtl bark\nmap_Kd textures\\bark.png\n',
    });
    expect([...(await obj.companions('tree.obj', objRead))].sort()).toEqual([
      'mats/textures/bark.png',
      'mats/tree.mtl',
    ]);
  });

  it('imports a malformed glTF rather than refusing it', async () => {
    // The loader produces an error the author can act on; refusing the import
    // only hides which file is broken.
    const gltf = importerForFile(registries, 'tree.gltf')!;
    expect(await gltf.companions('tree.gltf', reading({ 'tree.gltf': 'not json' }))).toEqual([]);
  });
});

describe('the preview URL', () => {
  const staged = (id: string, fileName: string): StagedFile => ({
    id,
    fileName,
    sourcePath: `/tmp/${fileName}`,
    sizeBytes: 0,
    importerId: fixedId('importer', 'model.fbx'),
    kind: 'model',
    formatLabel: 'FBX',
    settings: null,
    conflict: null,
    companions: [],
  });

  it('survives the round trip with its ids intact, case and all', () => {
    // The ids were in the host once. A host is case-insensitive and every URL
    // parser lowercases it, so a session called `Xq4A` came back as `xq4a`,
    // matched nothing, and every preview 404'd with no clue why.
    const url = importPreviewUrl('Xq4AbC', staged('lbCzs9VIzNOv', 'SM_HP_Tree.FBX'));

    expect(parseImportPreviewUrl(url)).toEqual({
      sessionId: 'Xq4AbC',
      fileId: 'lbCzs9VIzNOv',
      relativePath: 'SM_HP_Tree.FBX',
    });
  });

  it('keeps the extension last, which is what picks the loader', () => {
    expect(importPreviewUrl('s', staged('f', 'tree.gltf')).endsWith('/tree.gltf')).toBe(true);
  });

  it('reads a companion resolved against the file, as three does', () => {
    // `extractUrlBase` on the model's URL plus `maps/bark.png` — nothing has to
    // arrange this, which is exactly why the name has to be the last segment.
    const base = importPreviewUrl('s', staged('f', 'tree.gltf')).replace(/[^/]+$/, '');
    expect(parseImportPreviewUrl(`${base}maps/bark%20a.png`)).toEqual({
      sessionId: 's',
      fileId: 'f',
      relativePath: 'maps/bark a.png',
    });
  });

  it('refuses anything that is not one of ours', () => {
    expect(parseImportPreviewUrl('studio-asset://project/assets/tree.fbx')).toBeNull();
    expect(parseImportPreviewUrl('studio-import://elsewhere/s/f/tree.fbx')).toBeNull();
    expect(parseImportPreviewUrl('studio-import://session/s/f')).toBeNull();
    expect(parseImportPreviewUrl('not a url')).toBeNull();
  });
});
