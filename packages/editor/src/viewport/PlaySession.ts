import {
  deserializeScene,
  resolveScene,
  type RenderingSettings,
  type SceneDoc,
} from '@three-studio/core';
import { Engine, SceneHost } from '@three-studio/runtime';
import type { WebGPURenderer } from 'three/webgpu';
import { currentSceneName } from '../commands/sceneFiles';
import { editorAudioContext } from '../audio/context';
import { editorAssetResolver, useAssetStore } from '../state/assetStore';
import { useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { inPrefabMode, usePrefabModeStore } from '../state/prefabModeStore';
import { useProjectStore } from '../state/projectStore';
import { useScriptStore } from '../state/scriptStore';
import { useViewportStore } from '../state/viewportStore';
import type { Presentation } from './Presentation';

/**
 * What running a game needs from the viewport, and it is deliberately little.
 *
 * The renderer and the Game panel's canvas, because the engine draws through
 * the one renderer this document is allowed. And two announcements, because the
 * Scene view becomes a *view* while the game runs — flying it or dragging a
 * handle would edit a document that Stop is about to put back — and deciding
 * which of the viewport's parts that touches is the viewport's business, not
 * this one's.
 */
export interface PlayHost {
  readonly renderer: WebGPURenderer;
  /** The Game panel's own canvas; the engine's `Input` listens on it. */
  readonly gameView: Presentation;
  /** The project's rendering settings, as the Scene view is already using them. */
  readonly rendering: RenderingSettings;
  onPlayStarted(): void;
  onPlayStopped(): void;
}

/**
 * Play, Pause, Stop — and everything that has to happen around them.
 *
 * Lifted out of `EditorViewport`, where `beginPlay` alone was a hundred and
 * twenty lines among six other jobs. What is here is one question asked in one
 * place: what does pressing Play do, and what does Stop have to undo.
 */
export class PlaySession {
  /** Non-null while the game is running; owns its own scene graph and physics. */
  private engine: Engine | null = null;
  /** Owns the engine while playing, and moves between scenes. */
  private sceneHost: SceneHost | null = null;
  /** The document as it was when Play was pressed, restored on Stop. */
  private playSnapshot: SceneDoc | null = null;
  private unsubscribePlayState: (() => void) | null = null;

  constructor(private readonly host: PlayHost) {}

  /** The running game, or `null` when stopped. Read-only; use the transport. */
  get playEngine(): Engine | null {
    return this.engine;
  }

  get playing(): boolean {
    return this.engine !== null;
  }

  /**
   * Starts and stops the game in response to the transport buttons.
   *
   * The engine is created here rather than in a React component because it
   * draws through this renderer, and this document only gets one: a second
   * `WebGPURenderer` in the same frame destroys this one's output target every
   * frame. It has a canvas of its own, though — the Game panel's.
   */
  watch(): void {
    let previous = useEditorStore.getState().playState;

    this.unsubscribePlayState = useEditorStore.subscribe((state) => {
      const next = state.playState;
      if (next === previous) return;

      const wasStopped = previous === 'stopped';
      previous = next;

      if (next === 'stopped') this.endPlay();
      else if (wasStopped) void this.beginPlay();
    });
  }

  private async beginPlay(): Promise<void> {
    // Play means run the game, and a prefab on its own is not one — it usually
    // has no camera and no light, so it would come up black and warn about it.
    // Closing saves the prefab, so nothing is lost by leaving on the way.
    if (inPrefabMode()) await usePrefabModeStore.getState().exit();

    const document = useDocumentStore.getState();
    // Snapshot before anything runs: physics and scripts mutate the world, and
    // Stop has to put the scene back exactly as it was authored.
    this.playSnapshot = structuredClone(document.scene);

    // Compiled fresh on every Play, so editing a script and pressing Play is
    // the whole loop — no build step to remember.
    const compiled = await useScriptStore.getState().build();
    if (!compiled) {
      // Refused rather than started, as Unity refuses to enter play mode on a
      // compile error. Starting anyway means playing a build that does not
      // match the code on screen.
      // Stopped first: leaving play clears the warning list, so the message has
      // to be written after that or it is wiped the instant it appears.
      useEditorStore.getState().stop();
      useViewportStore
        .getState()
        .setPlayWarnings(['Scripts did not compile — see the Console.']);
      return;
    }

    try {
      // Hosted rather than created directly, so a script can move to another
      // scene while playing in the editor — a menu that starts a level has to
      // be testable without exporting a build first. The scene it starts on is
      // the document being edited, not `startScene`: pressing Play means "run
      // what is on screen".
      const host = new SceneHost({
        source: {
          // By id or by name, never by path: a build renames the entry scene
          // and files the rest elsewhere, so a script naming a path would work
          // here and break once exported.
          read: async (idOrName) => {
            const entry = resolveScene(useProjectStore.getState().scenes, idOrName);
            if (!entry) throw new Error(`No scene "${idOrName}" in this project.`);
            return deserializeScene(await window.studio.project.readScene(entry.path));
          },
        },
        loadingScene: useProjectStore.getState().project?.settings.loadingScene ?? null,
        resolver: editorAssetResolver,
        physicsSettings: useProjectStore.getState().project?.settings.physics,
        // The viewport's own, not the store's: Play has to draw with what the
        // Scene view is drawing with, and re-reading is how they came apart.
        rendering: this.host.rendering,
        // Without this a mesh linked to a material asset would play with its
        // embedded material — the scene would look different the moment you
        // pressed Play, for no reason the author could see.
        materials: useAssetStore.getState().materials,
        prefabs: useAssetStore.getState().prefabs,
        // Play mode draws on this same renderer, so the running scene captures
        // its sky on the device the editor already holds.
        renderer: this.host.renderer,
        // The Game panel's own canvas. The two views had to share one until
        // they could be drawn separately, and sharing it is what made pressing
        // Play hand the editor's pointer handling over to the game's.
        domElement: this.host.gameView.canvas,
        // The editor's one context, shared with the preview and kept apart from
        // it by a root gain each. `undefined` where there is no Web
        // Audio, which makes the game silent rather than broken.
        audioContext: editorAudioContext() ?? undefined,
      });
      this.sceneHost = host;

      // The document, not the expansion: the host expands every scene it runs,
      // and handing it one already expanded would do the work twice.
      // The name, which is what a script comparing `scenes.current` reads. It
      // is the indicative half of a scene's identity — and a
      // script that wants the stable half can name the id instead.
      await host.adopt(currentSceneName(), document.scene);
      const engine = host.engine;
      if (!engine) return;

      // A script may swap scenes at any point; the viewport renders through
      // whatever is current rather than the one it started with.
      host.onSceneChanged = (_path, next) => {
        this.engine = next;
        next.onWarning = (warnings) => {
          useViewportStore.getState().setPlayWarnings(warnings);
        };
        this.syncAspect(next);
      };
      if (useEditorStore.getState().playState === 'stopped') {
        // Stopped again while the physics module was loading. The host goes
        // too, and `this.sceneHost` is cleared: `endPlay` may already have run —
        // `this.sceneHost` was still null when it did, because the assignment above
        // happens after two awaits — and it would then never be taken down.
        host.dispose();
        if (this.sceneHost === host) this.sceneHost = null;
        return;
      }
      // A copy, and a live subscription: warnings raised later must reach the
      // panel, and React only redraws on a new reference.
      engine.onWarning = (warnings) => {
        useViewportStore.getState().setPlayWarnings(warnings);
      };
      this.engine = engine;
      // Pressing Play is the user gesture, which is the only moment a browser
      // will start an audio context. Missing it means a game that is silent
      // until something else happens to be clicked, with nothing to say why.
      void engine.audio?.unlock();
      // Not because they would fight the game for the pointer — each view has
      // its own canvas now — but because the Scene view is a *view* while the
      // game runs: flying it or dragging a handle would edit a document that
      // Stop is about to put back the way it was.
      useViewportStore.getState().setPlayWarnings([...engine.warnings]);
      // The camera, the handles and the size, none of which is this class's.
      this.host.onPlayStarted();
    } catch (cause) {
      useViewportStore
        .getState()
        .setError(cause instanceof Error ? cause.message : String(cause));
      useEditorStore.getState().stop();
    }
  }

  private endPlay(): void {
    // The host owns the engine once playing; disposing both would tear the
    // same one down twice.
    this.sceneHost?.dispose();
    this.sceneHost = null;
    this.engine = null;
    this.host.onPlayStopped();
    useViewportStore.getState().setPlayWarnings([]);

    if (this.playSnapshot) {
      useDocumentStore.getState().replaceScene(this.playSnapshot, { keepHistory: true });
      this.playSnapshot = null;
    }
  }

  /** Hands the running game the shape of the panel it is drawn in. */
  syncAspect(engine: Engine): void {
    if (!this.host.gameView.visible) return;
    engine.setViewportAspect(this.host.gameView.width / this.host.gameView.height);
  }

  /** Stops the game and unsubscribes. The session is not usable afterwards. */
  dispose(): void {
    this.unsubscribePlayState?.();
    // The host owns the engine, its loads in flight and its preloader. Disposing
    // the engine alone left all three alive, along with the `Input` listening on
    // a canvas that is about to go away.
    this.sceneHost?.dispose();
    this.sceneHost = null;
    this.engine?.dispose();
    this.engine = null;
  }
}
