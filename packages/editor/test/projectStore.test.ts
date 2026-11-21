import {
  PROJECT_FORMAT_VERSION,
  createBuildProfiles,
  createEmptyScene,
  createPhysicsSettings,
  createRenderingSettings,
  fixedId,
  serializeScene,
  type OpenProject,
} from '@three-studio/core';
import { scriptTypings } from '@three-studio/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useProjectStore } from '../src/state/projectStore';
import { builtInRegistries } from './registries';

const registries = builtInRegistries();

/*
 * A project the window opens is the window's from then on: the scripts' typings
 * are written into it from the registries the window runs, the only place that
 * knows what a module gives scripts, since the main process activates core
 * alone.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A project opened on `sceneJson`, as the main process answers. */
function opened(sceneJson: string): OpenProject {
  const sceneId = fixedId('scene', 'main');
  return {
    summary: { name: 'Typed', path: '/projects/typed', lastOpenedAt: 1 },
    project: {
      version: PROJECT_FORMAT_VERSION,
      name: 'Typed',
      engineVersion: '0.6.0',
      startScene: sceneId,
      settings: {
        loadingScene: null,
        rendering: createRenderingSettings(),
        physics: createPhysicsSettings(),
        build: createBuildProfiles('Typed'),
      },
    },
    scenes: [{ id: sceneId, name: 'main', path: 'scenes/main.scene.json', shadowedBy: null }],
    refusedScenes: [],
    sceneId,
    scenePath: 'scenes/main.scene.json',
    sceneJson,
  };
}

/** What the window asks of the main process as it opens a project, none of it settling but the typings' write. */
function bridge(written: unknown[]) {
  const pending = () => new Promise<never>(() => {});
  return {
    studio: {
      assets: { list: pending, readMaterials: pending, readPhysicsMaterials: pending, readPrefabs: pending },
      scripts: {
        build: pending,
        writeTypings: async (text: unknown) => {
          written.push(text);
        },
      },
    },
  };
}

describe('a project opened in the window', () => {
  it('has the main process write the script typings of the registries the window runs, once', () => {
    const written: unknown[] = [];
    vi.stubGlobal('window', bridge(written));

    useProjectStore.getState().adopt(registries, opened(serializeScene(registries, createEmptyScene())));

    expect(written).toEqual([scriptTypings(registries)]);
  });
});
