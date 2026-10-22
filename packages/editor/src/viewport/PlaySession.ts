import {
  LAUNCH_SNAPSHOT_VERSION,
  createPhysicsSettings,
  createRenderingSettings,
  deserializeScene,
  formatLogArgs,
  resolveScene,
  type LaunchSnapshot,
  type RenderingSettings,
  type SceneDoc,
  type SceneEntry,
} from '@three-studio/core';
import { Engine, SceneHost, type SceneSource } from '@three-studio/runtime';
import type { WebGPURenderer } from 'three/webgpu';
import { currentSceneName } from '../commands/sceneFiles';
import { editorAudioContext } from '../audio/context';
import { editorAssetResolver, useAssetStore } from '../state/assetStore';
import { useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { composedPrefabMode, inPrefabMode, usePrefabModeStore } from '../state/prefabModeStore';
import { useProjectStore } from '../state/projectStore';
import { useScriptStore } from '../state/scriptStore';
import { toastSlot } from '../state/toastStore';
import { useViewportStore } from '../state/viewportStore';
import type { Presentation } from './Presentation';

/**
 * What running a game needs from the viewport, and it is deliberately little.
 *
 * The renderer and the game's canvas, because the engine draws through the one
 * renderer this document is allowed. And two announcements, because from the
 * press of Play the edit view is no longer the editor's to drive — flying it
 * over a frozen picture, or dragging a handle into an edit the scene lock
 * refuses — and deciding which of the viewport's parts that touches is the
 * viewport's business, not this one's.
 */
export interface PlayHost {
  readonly renderer: WebGPURenderer;
  /** The game's own canvas, on the Viewport's stage; the engine's `Input` listens on it. */
  readonly gameView: Presentation;
  /** The project's rendering settings, as the edit view is already using them. */
  readonly rendering: RenderingSettings;
  /**
   * Play was pressed. Called before anything is awaited: the start takes as
   * long as the compile and the load, and the view is not the editor's for any
   * of it.
   */
  onPlayPressed(): void;
  onPlayStopped(): void;
}

/**
 * What Play runs, read from the editor's stores in one place.
 *
 * A device launch reads the same, so that a phone runs what Play would: two
 * readings drift, and a device that runs something else cannot be trusted to
 * show what is on screen.
 *
 * In Prefab Mode, the scene the prefab was opened from, with every open
 * prefab's unsaved edits composed in — without leaving the mode or saving
 * anything, which Play does on its way in but a launch may not.
 *
 * `entry.scene` is the document itself, not a copy: immer never changes a
 * published document in place, and from the press of Play the scene lock holds
 * it still, so Play keeps it as it is. Whoever hands it on copies it — the
 * scene source for the game, the main process across IPC.
 *
 * Here rather than in a module of its own: a module that reads the project
 * store and that this one imports would join the import cycle this file is
 * already part of (see `test/architecture.test.ts`).
 */
export function readPlayInputs(): LaunchSnapshot {
  const { project, sceneId } = useProjectStore.getState();
  const assets = useAssetStore.getState();
  const composed = composedPrefabMode();
  const scene = composed?.scene ?? useDocumentStore.getState().scene;
  return {
    version: LAUNCH_SNAPSHOT_VERSION,
    // The window's id, never the document's: the window's is the one the
    // project's scene list and every reference use. The document's own is
    // only a fallback for a window with no project, which a test alone reaches.
    entry: { id: sceneId ?? scene.id, name: currentSceneName(), scene },
    materials: assets.materials,
    prefabs: composed?.prefabs ?? assets.prefabs,
    rendering: project?.settings.rendering ?? createRenderingSettings(),
    physics: project?.settings.physics ?? createPhysicsSettings(),
    loadingScene: project?.settings.loadingScene ?? null,
  };
}

/**
 * The inputs of the game running in this window, `null` when stopped.
 *
 * Module-level rather than on the session, because a launch asks without a
 * session to hand — and a window has one viewport, so one session.
 */
let running: LaunchSnapshot | null = null;

/**
 * What a device launch sends: while the editor plays, what Play started from —
 * never a world the running game has mutated, nor an edit made since; otherwise
 * what Play would run now.
 */
export function launchSnapshot(): LaunchSnapshot {
  return running ?? readPlayInputs();
}

/**
 * Where a running game finds its scenes: by id or by name, never by path — a
 * build files every scene under its id, so a script naming a path would work
 * here and break once exported.
 *
 * The entry is answered from what Play started with every time it is asked
 * for, not only the first: a script that restarts the level asks for the scene
 * it is in, and the saved file used to answer, so a restart dropped every
 * unsaved edit. A device answers the same way, from the launch it holds.
 * A fresh copy each time, the game's first scene included: the game mutates
 * the world it is handed, the next restart has to begin from the scene as
 * authored, and the entry's scene is the editor's own document.
 *
 * Every other scene is read from its file, as it always was.
 */
export function playSceneSource(
  entry: LaunchSnapshot['entry'],
  readFile: (path: string) => Promise<string>,
): SceneSource {
  return {
    read: async (idOrName) => {
      if (namesEntry(entry, idOrName)) return structuredClone(entry.scene);
      const scene = resolveScene(useProjectStore.getState().scenes, idOrName);
      if (!scene) throw new Error(`No scene "${idOrName}" in this project.`);
      return deserializeScene(await readFile(scene.path));
    },
  };
}

/**
 * The id of the scene a running game asked for, by the rule `playSceneSource`
 * reads it with: the entry by its id or its name, then the project's scenes by
 * id, then by name. `null` when the project has no such scene.
 *
 * A game asks for a scene by whatever it was given — Play adopts its first
 * scene by its name, the loading scene setting holds an id, a script names
 * either — and what the editor keeps of a scene is its id. By the source's own
 * rule, so that the id is the one of the scene the game was handed: the entry's
 * name finds the entry even where another folder holds a file of that name.
 */
export function playSceneId(
  entry: LaunchSnapshot['entry'],
  scenes: readonly SceneEntry[],
  idOrName: string,
): string | null {
  if (namesEntry(entry, idOrName)) return entry.id;
  return resolveScene(scenes, idOrName)?.id ?? null;
}

/** Whether a game asking for `idOrName` asks for the scene Play started from. */
function namesEntry(entry: LaunchSnapshot['entry'], idOrName: string): boolean {
  return idOrName === entry.id || idOrName === entry.name;
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
  /**
   * The document as it was at the press, once Prefab Mode is left; `null` while
   * stopped. Stop asks whether the document is still this object.
   *
   * Nothing moves it in between, and that is what makes asking by identity
   * enough: the scene lock refuses every write from the press, immer never
   * changes a published document in place, and the game is handed a copy,
   * never this.
   */
  private startedFrom: SceneDoc | null = null;
  private unsubscribePlayState: (() => void) | null = null;
  /**
   * Which start is the one somebody waits for: bumped at every press, every
   * Stop and `dispose`. A start that finds it moved after an await has been
   * replaced — by a Stop, or by a Stop and another Play — and goes no further,
   * saying nothing.
   *
   * A count, because asking whether something is stopped, which is what each
   * await used to ask, cannot tell one Play from the next: with Play, Stop and
   * Play again during one compile, the first start saw a game running, so its
   * compile failure stopped the second Play, and a host it went on to build ran
   * beside the second's.
   */
  private session = 0;
  /** A failed Play, said once and never stacked; the next press takes it away. */
  private readonly failure = toastSlot();

  constructor(private readonly host: PlayHost) {}

  /** The running game, or `null` when stopped. Read-only; use the transport. */
  get playEngine(): Engine | null {
    return this.engine;
  }

  /**
   * Starts and stops the game in response to the transport buttons.
   *
   * The engine is created here rather than in a React component because it
   * draws through this renderer, and this document only gets one: a second
   * `WebGPURenderer` in the same frame destroys this one's output target every
   * frame. It has a canvas of its own, though — the game's, on the Viewport's
   * stage.
   */
  watch(): void {
    let previous = useEditorStore.getState().playState;

    this.unsubscribePlayState = useEditorStore.subscribe((state) => {
      const next = state.playState;
      if (next === previous) return;

      const wasStopped = previous === 'stopped';
      previous = next;

      if (next === 'stopped') this.endPlay();
      else if (wasStopped) {
        // Taken away at the press, before anything is awaited: it is about the
        // Play this one replaces, whether or not this one goes any better.
        this.failure.dismiss();
        this.session += 1;
        useViewportStore.getState().setGameShown(false);
        // Named from the press, before the compile and the load: what starts
        // is the window's scene, from Prefab Mode too.
        useViewportStore.getState().setRunningScene(useProjectStore.getState().sceneId);
        this.host.onPlayPressed();
        void this.beginPlay(this.session);
      }
    });
  }

  /**
   * One start, from the press to the first engine.
   *
   * Every await is followed by asking whether this start is still the one
   * somebody waits for (`session`), and one `try` holds the whole of it, leaving
   * Prefab Mode included. That first await used to sit outside the `try`: a
   * prefab that failed to save rejected out of `void this.beginPlay()` as an
   * unhandled rejection, the transport left on Play with no game ever to come.
   */
  private async beginPlay(session: number): Promise<void> {
    const current = () => this.session === session;
    try {
      // Play means run the game, and a prefab on its own is not one — it usually
      // has no camera and no light, so it would come up black and warn about it.
      // Closing saves the prefab, so nothing is lost by leaving on the way.
      if (inPrefabMode()) await usePrefabModeStore.getState().exit();
      // Stopped while Prefab Mode was being left: `endPlay` has run already, and
      // nothing after it would clear what is taken below — every launch would
      // send a scene the person has since gone on editing.
      if (!current()) return;

      // Read at the press, before anything runs. The materials, prefabs and
      // settings used to be read after the compile; they are read here with
      // the scene, so a launch made during Play sends exactly what Play
      // started from.
      //
      // The entry keeps the document itself, with no copy taken: the scene
      // lock holds it still until Stop. It is what Stop checks the document
      // against, what a restarted level is answered with — copied by the scene
      // source at every read — and what a launch made during Play sends.
      const inputs = readPlayInputs();
      this.startedFrom = inputs.entry.scene;
      running = inputs;

      // Compiled fresh on every Play, so editing a script and pressing Play is
      // the whole loop — no build step to remember.
      const compiled = await useScriptStore.getState().build();
      if (!current()) return;
      if (!compiled) {
        // Refused rather than started, as Unity refuses to enter play mode on a
        // compile error. Starting anyway means playing a build that does not
        // match the code on screen.
        //
        // Said in a toast, where the person is looking. It used to go into the
        // problems laid over the running game — and there is no running game
        // after a refusal, so nothing was ever said. The errors themselves are
        // in the Console already: the build writes them there.
        useEditorStore.getState().stop();
        const count = useScriptStore.getState().errors.length;
        this.sayFailure(
          'Scripts did not compile',
          `${count} ${count === 1 ? 'error' : 'errors'}, listed in the Console.`,
        );
        return;
      }

      // Hosted rather than created directly, so a script can move to another
      // scene while playing in the editor — a menu that starts a level has to
      // be testable without exporting a build first. The scene it starts on is
      // the document being edited, not `startScene`: pressing Play means "run
      // what is on screen".
      const source = playSceneSource(inputs.entry, (path) => window.studio.project.readScene(path));
      const host = new SceneHost({
        source,
        loadingScene: inputs.loadingScene,
        resolver: editorAssetResolver,
        physicsSettings: inputs.physics,
        // The viewport's own, not the inputs': Play draws on the viewport's
        // renderer, which was made with these and is not remade when Project
        // Settings saves new ones — so Play has to draw with what the edit view
        // is drawing with, and re-reading is how they came apart. A launch
        // sends the project's, since a phone makes a new renderer every time.
        rendering: this.host.rendering,
        // Without this a mesh linked to a material asset would play with its
        // embedded material — the scene would look different the moment you
        // pressed Play, for no reason the author could see.
        materials: inputs.materials,
        prefabs: inputs.prefabs,
        // Play mode draws on this same renderer, so the running scene captures
        // its sky on the device the editor already holds.
        renderer: this.host.renderer,
        // The game's own canvas. The two views had to share one until they
        // could be drawn separately, and sharing it is what made pressing Play
        // hand the editor's pointer handling over to the game's.
        domElement: this.host.gameView.canvas,
        // And the keys typed into it alone, while it holds the focus. The
        // editor is the same page: heard window-wide, a space typed in the
        // Console during Play made the player jump, and never reached the
        // field, since the game keeps Space and the arrows from the browser.
        input: { keys: 'element' },
        // The editor's one context, shared with the preview and kept apart from
        // it by a root gain each. `undefined` where there is no Web
        // Audio, which makes the game silent rather than broken.
        audioContext: editorAudioContext() ?? undefined,
      });
      this.sceneHost = host;

      // A copy of the document, through the door a restart takes — never the
      // document. A script's `this.entity` is the entity the game is handed,
      // and a property's value is the scene's own (a `vec3` is an array):
      // handed the document, a script wrote the editor's scene, silently while
      // it had not been edited since it was opened, and with a `TypeError` that
      // disabled the script once immer had frozen it, where the same script
      // works in the exported player. Still one copy per Play: it used to be
      // taken for Stop, and is taken for the game.
      //
      // Not the expansion: the host expands every scene it runs, and handing
      // it one already expanded would do the work twice. Under its name, which
      // is what a script comparing `scenes.current` reads. It is the indicative
      // half of a scene's identity — and a script that wants the stable half
      // can name the id instead.
      await host.adopt(inputs.entry.name, await source.read(inputs.entry.name));
      // Stopped while the engine was being built — the physics module and every
      // model the scene needs. That Stop took this host down, since it was
      // `this.sceneHost` by then, and `swap`, finding the host disposed, threw
      // the engine away: there is nothing left to hand over.
      if (!current()) return;
      const engine = host.engine;
      if (!engine) return;

      // A script may swap scenes at any point; the viewport renders through
      // whatever is current rather than the one it started with. Each one by
      // its id, whatever the game asked for it by; the scene list is read as
      // it is at each change, a scene added meanwhile included.
      const sceneIdOf = (asked: string) => playSceneId(inputs.entry, useProjectStore.getState().scenes, asked);
      host.onSceneChanged = (asked, next) => this.run(next, sceneIdOf(asked));
      this.run(engine, sceneIdOf(inputs.entry.name));
      // Pressing Play is the user gesture, which is the only moment a browser
      // will start an audio context. Missing it means a game that is silent
      // until something else happens to be clicked, with nothing to say why.
      void engine.audio?.unlock();
    } catch (cause) {
      // A start nobody waits for any more says nothing: whatever it would say is
      // about a Play the person has already stopped or pressed again.
      if (!current()) return;
      // The message for the Console, the stack for devtools — the Console writes
      // an error as its name and message.
      console.error('[play] The game could not start:', cause);
      // Said in a toast, and the edit view kept. A throw here used to be
      // written as the renderer's failure, which took the whole Viewport over
      // with "The renderer failed to start." for good, over a renderer that
      // worked.
      useEditorStore.getState().stop();
      this.sayFailure('The game could not start', formatLogArgs([cause]).split('\n')[0] ?? '');
    }
  }

  /**
   * The frame loop has just drawn the running game. The first time, the game
   * has a frame of its own to take the edit image's place with; before there
   * is an engine there was nothing to draw, and this says nothing.
   */
  gameDrawn(): void {
    if (this.engine === null || useViewportStore.getState().gameShown) return;
    useViewportStore.getState().setGameShown(true);
  }

  /**
   * Makes `engine` the one the viewport draws: the first, and each one a
   * script moves to. And publishes which scene it runs, `sceneId`.
   *
   * Its problems are published here, at each activation: what it found while it
   * was built — no camera, no light, a body with no collider — which goes into
   * `warnings` without `onWarning` hearing of it, then whatever it raises later.
   * A script's change of scene used to wire the next engine's `onWarning` and
   * stop there, so the scene left behind went on listing its problems over the
   * next one, whose own were never shown. The exported player says them again
   * at every scene; so does this.
   */
  private run(engine: Engine, sceneId: string | null): void {
    this.engine = engine;
    useViewportStore.getState().setRunningScene(sceneId);
    // A copy, and a live subscription: warnings raised later must reach the
    // panel, and React only redraws on a new reference.
    engine.onWarning = (warnings) => {
      useViewportStore.getState().setPlayWarnings(warnings);
    };
    useViewportStore.getState().setPlayWarnings([...engine.warnings]);
    this.syncAspect(engine);
  }

  /**
   * Says why Play stopped as soon as it was pressed, in one error toast: it
   * stays until it is dismissed, or until the next press replaces the Play it
   * is about. The details are in the Console, which it offers — the Console is
   * also in the Window menu, so the toast is never the only way there.
   */
  private sayFailure(title: string, description: string): void {
    this.failure.show({
      kind: 'error',
      title,
      description,
      actions: [
        { label: 'Show Console', primary: true, onClick: () => useEditorStore.getState().requestConsole() },
      ],
    });
  }

  private endPlay(): void {
    // Whatever start is still under way is one nobody waits for now.
    this.session += 1;
    // The host owns the engine once playing; disposing both would tear the
    // same one down twice.
    this.sceneHost?.dispose();
    this.sceneHost = null;
    this.engine = null;
    running = null;
    this.host.onPlayStopped();
    useViewportStore.getState().setPlayWarnings([]);
    useViewportStore.getState().setGameShown(false);
    useViewportStore.getState().setRunningScene(null);

    // The document Stop finds is the one Play started from: the lock held it
    // still and the game played a copy. Putting it back anyway, as Stop did
    // with a copy taken at the press, made every entity a new object and had
    // the edit view, the Hierarchy and the Inspector re-read the whole
    // document, at every Stop.
    const startedFrom = this.startedFrom;
    this.startedFrom = null;
    if (startedFrom === null || useDocumentStore.getState().scene === startedFrom) return;
    // Something wrote the scene round the lock. Put back what Play started
    // from, as Stop always did, and name it in development: it is a hole in
    // the lock, and the fix belongs where the write came from.
    if (import.meta.env.DEV) {
      console.error(
        '[play] The scene changed while the game ran, round the lock; Stop put back the document Play started from.',
      );
    }
    useDocumentStore.getState().replaceScene(startedFrom, { keepHistory: true });
  }

  /** Hands the running game the shape of the canvas it is drawn in. */
  syncAspect(engine: Engine): void {
    if (!this.host.gameView.visible) return;
    engine.setViewportAspect(this.host.gameView.width / this.host.gameView.height);
  }

  /** Stops the game and unsubscribes. The session is not usable afterwards. */
  dispose(): void {
    this.unsubscribePlayState?.();
    this.session += 1;
    // The host owns the engine, its loads in flight and its preloader. Disposing
    // the engine alone left all three alive, along with the `Input` listening on
    // a canvas that is about to go away. And the host alone: the engine is the
    // host's, and disposing it again freed its physics world a second time,
    // which Rapier answers by throwing — out of a teardown with the renderer
    // and the rest of the viewport still to go.
    this.sceneHost?.dispose();
    this.sceneHost = null;
    this.engine = null;
    running = null;
    useViewportStore.getState().setRunningScene(null);
  }
}
