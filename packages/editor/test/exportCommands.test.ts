import {
  createEmptyScene,
  createMeshEntity,
  type AssetKind,
  type ExportResult,
} from '@three-studio/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runExport } from '../src/commands/exportCommands';
import { addEntity } from '../src/commands/sceneCommands';
import { useDocumentStore } from '../src/state/documentStore';
import { usePrefabModeStore } from '../src/state/prefabModeStore';
import { useToastStore } from '../src/state/toastStore';

/*
 * The export reads the project off disk and never saves on the author's
 * behalf, so an edit made since the last save is not in the build. It used to
 * say nothing about it: the build simply did not look like the editor.
 */

const KINDS: AssetKind[] = ['model', 'texture', 'material', 'prefab', 'shader', 'audio', 'script'];

function result(): ExportResult {
  return {
    outputDir: '/tmp/build',
    sceneCount: 1,
    assetCount: 0,
    scriptCount: 0,
    size: {
      total: 10,
      player: 10,
      scenes: 0,
      scripts: 0,
      assets: Object.fromEntries(KINDS.map((kind) => [kind, 0])) as Record<AssetKind, number>,
    },
    warnings: [],
  };
}

const toast = () => useToastStore.getState().toasts.at(-1)!;

beforeEach(async () => {
  await usePrefabModeStore.getState().exit();
  usePrefabModeStore.setState({ stack: [] });
  useDocumentStore.getState().replaceScene(createEmptyScene());
  useToastStore.setState({ toasts: [] });
  // Only what packaging reaches. No `save`: a call to it would throw, which is
  // the test that the export never saves on its own.
  vi.stubGlobal('window', {
    studio: {
      platform: 'darwin',
      build: {
        export: async () => result(),
        onProgress: () => () => undefined,
        revealOutput: async () => undefined,
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('packaging a window with unsaved edits', () => {
  it('says the build was made from the saved files', async () => {
    addEntity(createMeshEntity('box'));

    runExport();

    await vi.waitFor(() => expect(toast().kind).toBe('warning'));
    expect(toast().details).toMatch(/unsaved changes\. The build was made from the saved files/);
    // Still unsaved: the export never writes the scene for the author.
    expect(useDocumentStore.getState().savedRevision).not.toBe(
      useDocumentStore.getState().revision,
    );
  });

  it('says nothing of the kind when everything is saved', async () => {
    runExport();

    await vi.waitFor(() => expect(toast().kind).toBe('success'));
    expect(toast().details).not.toMatch(/unsaved/);
  });
});
