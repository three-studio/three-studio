import {
  ASSET_MANIFEST_VERSION,
  createCameraEntity,
  createEmptyScene,
  createEntity,
  createLightEntity,
  createMeshEntity,
  defaultSettings,
  findComponent,
  type AssetEntry,
  type AssetKind,
} from '@three-studio/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { close, prefabWith } from '../../core/test/fixtures';
import { addEntityInView, placeDroppedAsset, placedAt } from '../src/commands/placeEntity';
import { addEntity } from '../src/commands/sceneCommands';
import { worldPosition } from '../src/commands/transformSpace';
import { buildAddMenu } from '../src/shell/addMenu';
import { useAssetStore } from '../src/state/assetStore';
import { useDocumentStore } from '../src/state/documentStore';
import { useEditorStore } from '../src/state/editorStore';
import { STOP_TO_EDIT } from '../src/state/sceneLock';
import { useToastStore } from '../src/state/toastStore';
import type { MenuEntry, MenuItem } from '../src/ui/Menu';

/*
 * Where an object added from the menu ends up.
 *
 * There is no canvas under vitest, so `peekViewport()` answers `null` and the
 * placement point stays at the origin. That is the half of the behaviour these
 * tests can reach; the viewport's own half is a three-line call onto
 * `dropPoint`, whose two pieces are covered by `picking.test.ts` and
 * `dropPlane.test.ts`.
 */

const doc = () => useDocumentStore.getState();
const selection = () => useEditorStore.getState().selection;
const toasts = () => useToastStore.getState().toasts;
const play = () => useEditorStore.getState().play();
const stop = () => useEditorStore.getState().stop();
const realManifest = useAssetStore.getState().manifest;
const realPrefabs = useAssetStore.getState().prefabs;

beforeEach(() => {
  stop();
  useToastStore.getState().clear();
  doc().replaceScene(createEmptyScene());
  useEditorStore.getState().clearSelection();
});

afterEach(() => {
  stop();
  useAssetStore.setState({ manifest: realManifest, prefabs: realPrefabs });
  vi.restoreAllMocks();
});

describe('the transform a template needs to land on a point', () => {
  it('reads the default position as an offset from that point', () => {
    const cube = createMeshEntity('box');
    const placed = placedAt(cube.entity.transform, [10, 0, 5]);

    // The 0.5 is the cube resting on the surface, not a place it wanted to be.
    close(placed.position, [10, 0.5, 5]);
  });

  it('keeps the offset a camera describes', () => {
    const camera = createCameraEntity();

    // (0, 2, 8) means "two up and eight back from what I am looking at".
    close(placedAt(camera.entity.transform, [0, 0, -20]).position, [0, 2, -12]);
  });

  it('leaves rotation and scale alone', () => {
    // A plane is flat and a sun light is angled wherever they are put; only the
    // position is a place.
    const plane = createMeshEntity('plane');
    const placed = placedAt(plane.entity.transform, [7, -3, 7]);

    close(placed.rotation, plane.entity.transform.rotation);
    close(placed.scale, [1, 1, 1]);
    close(placed.position, [7, -3, 7]);
  });
});

describe('adding from the menu', () => {
  it('goes to the root', () => {
    const id = addEntityInView(createMeshEntity('box'))!;

    expect(doc().scene.rootOrder).toContain(id);
    expect(doc().scene.entities[id]?.parent).toBeNull();
    close(worldPosition(doc().scene, id), [0, 0.5, 0]);
  });

  it('goes to the root even with something selected', () => {
    /*
     * Deliberate, and reversed after trying the other way. Unity parents a new
     * object to the selection and it is the most complained-about thing about
     * its Add menu: a hierarchy nobody asked for, from a selection they had
     * forgotten. Unreal and Blender add at the top; nesting stays a gesture of
     * its own — the hierarchy drag, or Cmd+G.
     */
    const selected = addEntity(createEntity('Parent'));
    useEditorStore.getState().setSelection([selected]);

    const id = addEntityInView(createMeshEntity('box'))!;

    expect(doc().scene.entities[id]?.parent).toBeNull();
    expect(doc().scene.entities[selected]?.children).toEqual([]);
    expect(doc().scene.rootOrder).toContain(id);
  });

  it('leaves an ambient light at the origin', () => {
    const id = addEntityInView(createLightEntity('ambient'))!;

    expect(doc().scene.entities[id]?.transform.position).toEqual([0, 0, 0]);
  });

  it('stays one undo step, selection included', () => {
    const selected = addEntity(createEntity('Parent'));
    useEditorStore.getState().setSelection([selected]);

    const id = addEntityInView(createMeshEntity('box'))!;
    expect(useEditorStore.getState().selection).toEqual([id]);

    doc().undo();

    expect(doc().scene.entities[id]).toBeUndefined();
    expect(useEditorStore.getState().selection).toEqual([selected]);
  });
});

describe('adding from the menu while the game runs', () => {
  it('is refused, said once, with nothing measured or added', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    play();

    expect(addEntityInView(createMeshEntity('box'))).toBeNull();
    expect(addEntityInView(createMeshEntity('sphere'))).toBeNull();

    expect(doc().scene.rootOrder).toEqual([]);
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]!.title).toBe('Stop the game to edit the scene');
    // Refused before the document was asked: its backstop never heard of it.
    expect(error).not.toHaveBeenCalled();

    stop();
    expect(addEntityInView(createMeshEntity('box'))).toEqual(expect.any(String));
  });

  it('greys every row that places, Group included, saying why', () => {
    // Something selected, so Group would act: greyed only for the game's sake.
    useEditorStore.getState().setSelection([addEntity(createMeshEntity('box'))]);
    const menu = () => buildAddMenu();
    /** The rows that place something: the leaves, under their headings. */
    const placing = (entries: readonly MenuEntry[]): MenuItem[] =>
      entries.flatMap((entry) => (entry === null ? [] : entry.submenu ? placing(entry.submenu) : [entry]));
    const headings = (entries: readonly MenuEntry[]): MenuItem[] =>
      entries.filter((entry): entry is MenuItem => entry !== null && entry.submenu !== undefined);
    expect(placing(menu()).length).toBeGreaterThan(10);

    for (const row of placing(menu())) {
      expect(row.disabled ?? false, row.label).toBe(false);
      expect(row.detail, row.label).toBeUndefined();
    }

    play();
    for (const row of placing(menu())) {
      expect(row.disabled, row.label).toBe(true);
      expect(row.detail, row.label).toBe(STOP_TO_EDIT);
    }
    // A heading opens its submenu, whose rows say why.
    for (const heading of headings(menu())) expect(heading.disabled ?? false, heading.label).toBe(false);
  });
});

describe('a drop on the view', () => {
  const entry = (id: string, kind: AssetKind, name: string): AssetEntry => ({
    id,
    name,
    kind,
    path: `assets/${name}`,
    folder: '',
    sizeBytes: 1,
    modifiedAt: 0,
    importedAt: 0,
    hash: '',
    settings: defaultSettings(kind),
    importedPath: null,
  });

  beforeEach(() => {
    const inside = createMeshEntity('box');
    useAssetStore.setState({
      manifest: {
        version: ASSET_MANIFEST_VERSION,
        assets: [
          entry('crate', 'prefab', 'Crate'),
          entry('chime', 'audio', 'Chime'),
          entry('chair', 'model', 'Chair'),
          entry('brick', 'texture', 'Brick'),
        ],
        folders: [],
      },
      prefabs: { crate: prefabWith('Crate', [inside], inside.entity.id) },
    });
  });

  it('places a prefab as an instance where it was let go, selected inside its undo step', () => {
    const before = addEntity(createEntity('Before'));

    placeDroppedAsset('crate', [1, 2, 3]);

    const [id] = selection();
    expect(id).not.toBe(before);
    expect(findComponent(doc().scene, id!, 'prefabInstance')?.assetId).toBe('crate');
    expect(doc().scene.entities[id!]!.transform.position).toEqual([1, 2, 3]);

    doc().undo();
    expect(doc().scene.entities[id!]).toBeUndefined();
    expect(selection()).toEqual([before]);

    // The selection was set after the edit, outside its entry, so Redo brought
    // the instance back unselected.
    doc().redo();
    expect(selection()).toEqual([id]);
  });

  it('places a sound as an audio source, and a model as a model', () => {
    placeDroppedAsset('chime', [0, 1, 0]);
    const [sound] = selection();
    placeDroppedAsset('chair', [4, 0, 0]);
    const [model] = selection();

    expect(findComponent(doc().scene, sound!, 'audioSource')?.assetId).toBe('chime');
    expect(doc().scene.entities[sound!]!.transform.position).toEqual([0, 1, 0]);
    expect(findComponent(doc().scene, model!, 'model')?.assetId).toBe('chair');
    expect(doc().scene.entities[model!]!.transform.position).toEqual([4, 0, 0]);
  });

  it('places nothing for an asset that is not placed, and says nothing', () => {
    // A texture became a model entity pointing at a picture: an entity that
    // could never load anything, and said nothing about why.
    const revision = doc().revision;

    placeDroppedAsset('brick', [0, 0, 0]);

    expect(doc().scene.rootOrder).toEqual([]);
    expect(doc().revision).toBe(revision);
    expect(toasts()).toEqual([]);
  });

  it('is refused while the game runs, said once', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    play();

    placeDroppedAsset('crate', [1, 2, 3]);
    placeDroppedAsset('chair', [1, 2, 3]);

    expect(doc().scene.rootOrder).toEqual([]);
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]!.title).toBe('Stop the game to edit the scene');
    expect(error).not.toHaveBeenCalled();
  });
});
