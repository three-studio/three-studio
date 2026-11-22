/**
 * A scene being fetched.
 *
 * In a file of its own, importing nothing, so a world and a script can both
 * hold one without depending on the thing that runs them — the host builds
 * worlds, and a world that imported the host would be a cycle.
 */
export interface SceneLoadHandle {
  readonly path: string;
  /** 0 to 1 across the assets the scene needs. */
  readonly progress: number;
  /** Settles when it could be shown. */
  readonly ready: Promise<void>;
  readonly activated: boolean;
  /** Shows it, waiting for `ready` first if it has to. */
  activate(): Promise<void>;
  cancel(): void;
}

/** How a scene is loaded. */
export interface SceneLoadOptions {
  /** Alongside the scenes loaded, rather than in place of the active one. */
  readonly additive?: boolean;
}

/** Moving between scenes, from inside a script. */
export interface SceneApi {
  /**
   * The running scene's name, for a script that branches on where it is.
   *
   * The name is the indicative half of a scene's identity and can be changed
   * by whoever is using the editor; a script that must not break when it is
   * should hold the scene's id instead, which `load` and `go` also accept.
   */
  readonly current: string | null;
  /**
   * Starts fetching, without showing. Poll `progress`, then `activate()`.
   * Additive, it is built beside the scenes loaded and started beside them,
   * and a switch leaves it until `unload`; a scene is loaded once, and asking
   * again hands back its handle.
   */
  load(scene: string, options?: SceneLoadOptions): SceneLoadHandle;
  /** Fetches and shows, for a transition with nothing to display meanwhile. */
  go(scene: string): Promise<void>;
  /** An additive scene, once this frame is over. The active one is refused: a switch replaces it. */
  unload(scene: string): Promise<void>;
  /** Held by the game across every switch, read and written by every scene's scripts. */
  readonly data: Map<string, unknown>;
}
