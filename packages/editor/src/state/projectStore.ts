import {
  deserializeScene,
  serializeScene,
  type OpenProject,
  type ProjectContents,
  type ProjectFile,
  type ProjectSummary,
  type SceneEntry,
} from '@three-studio/core';
import { create } from 'zustand';
import { peekViewport } from '../viewport/viewportHost';
import { editorAssetResolver, useAssetStore } from './assetStore';
import { useDocumentStore } from './documentStore';
import { inPrefabMode, usePrefabModeStore } from './prefabModeStore';
import { useScriptStore } from './scriptStore';

interface ProjectState {
  /** `null` while the launcher is showing. */
  summary: ProjectSummary | null;
  project: ProjectFile | null;
  /**
   * Every scene of the project, as the main process found them on disk.
   *
   * Held beside the project rather than in it: the list is the `scenes/`
   * directory, and this window cannot read a directory. It arrives with the
   * project and is replaced whenever the project is, so the two never describe
   * different moments.
   */
  scenes: SceneEntry[];
  /** Id of the scene this window edits — what every reference uses. */
  sceneId: string | null;
  /** Where its file is. Needed to save it, and for nothing else. */
  scenePath: string | null;
  /** Set while a save is in flight, and after a save that failed. */
  saving: boolean;
  error: string | null;

  adopt: (opened: OpenProject) => void;
  /** Replaces the project file after its settings were written back. */
  adoptProject: (project: ProjectFile) => void;
  /**
   * Replaces the project and its scene list together.
   *
   * What every write that can add or remove a scene hands back, and what
   * another window's write arrives as. Separate from `adoptProject` because
   * settings cannot change the list, and a call that carried it would invite
   * one that carried a stale one.
   */
  adoptContents: (contents: ProjectContents) => void;
  /**
   * Same document, new file: after a Save As.
   *
   * No reload — nothing about what is on screen has changed, and reloading
   * would cost the undo history. The URL is rewritten in place so that a later
   * reload still finds the scene this window is on; see `windows.ts` for why the
   * scene lives in the URL at all.
   *
   * Renaming comes through here too, now that the file name is the name: the
   * document on screen has not changed, but its file has moved, and a window
   * that kept the old path would write the scene back under the name it had.
   */
  retarget: (contents: ProjectContents, scene: SceneEntry) => void;
  close: () => void;
  save: () => Promise<void>;
  setError: (error: string | null) => void;
}

export const useProjectStore = create<ProjectState>()((set, get) => ({
  summary: null,
  project: null,
  scenes: [],
  sceneId: null,
  scenePath: null,
  saving: false,
  error: null,

  adoptProject: (project) => set({ project }),

  adoptContents: ({ project, scenes }) => set({ project, scenes }),

  retarget: ({ project, scenes }, scene) => {
    const url = new URL(window.location.href);
    url.searchParams.set('scene', scene.id);
    window.history.replaceState(null, '', url);
    set({ project, scenes, sceneId: scene.id, scenePath: scene.path });
  },

  adopt: (opened) => {
    // Parsing here rather than in the main process keeps the scene format
    // owned entirely by @three-studio/core, which the web export also uses.
    const scene = deserializeScene(opened.sceneJson);
    useDocumentStore.getState().replaceScene(scene);
    void useAssetStore.getState().refresh();
    // Compiled on open, not only on Play: the inspector reads a script's
    // declared properties from the compiled class, so without this a script
    // component would show no fields until the game had been run once.
    void useScriptStore.getState().build();
    peekViewport()?.binder.setAssetResolver(editorAssetResolver);
    set({
      summary: opened.summary,
      project: opened.project,
      scenes: opened.scenes,
      sceneId: opened.sceneId,
      scenePath: opened.scenePath,
      error: null,
    });
  },

  close: () => {
    // The main process stops serving assets for this project too.
    void window.studio.project.close();
    set({ summary: null, project: null, scenes: [], sceneId: null, scenePath: null, error: null });
  },

  save: async () => {
    const { summary, scenePath } = get();
    if (!summary || scenePath === null) return;

    // The document holds a prefab right now, not the scene. Writing it to the
    // scene file would replace the level with one barrel — and the scene it
    // replaced is still sitting in the stash, unsaved.
    if (inPrefabMode()) {
      await usePrefabModeStore.getState().exit();
    }

    set({ saving: true, error: null });
    try {
      await window.studio.project.saveScene({
        projectPath: summary.path,
        scenePath,
        contents: serializeScene(useDocumentStore.getState().scene),
      });
      useDocumentStore.getState().markClean();
    } catch (cause) {
      set({ error: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      set({ saving: false });
    }
  },

  setError: (error) => set({ error }),
}));
