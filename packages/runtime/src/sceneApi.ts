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
  /** Starts fetching, without showing. Poll `progress`, then `activate()`. */
  load(scene: string): SceneLoadHandle;
  /** Fetches and shows, for a transition with nothing to display meanwhile. */
  go(scene: string): Promise<void>;
}
