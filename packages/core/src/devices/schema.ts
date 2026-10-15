import type { PhysicsSettings, RenderingSettings } from '../project/schema';
import type { PrefabDoc } from '../scene/prefab';
import type { MaterialDef, SceneDoc } from '../scene/schema';

export const LAUNCH_SNAPSHOT_VERSION = 1;

/**
 * What a device launch runs: the editor's in-memory state, as Play would run it.
 *
 * Read from memory rather than from disk, because the point of launching on a
 * phone is to see what is on screen — unsaved edits included — and launching
 * may not save. Scripts are not in it: the main process compiles them from
 * disk, as Play does. Every other scene is read from disk when asked for, as
 * Play does too.
 */
export interface LaunchSnapshot {
  version: typeof LAUNCH_SNAPSHOT_VERSION;
  /**
   * The scene on screen — in Prefab Mode, the scene the prefab was opened from.
   *
   * `id` and `name` are the window's, never the document's own `id`: the
   * window's id is what the project's scene list and every reference use, and
   * the entry is always answered from here, so it needs no file on disk.
   */
  entry: { id: string; name: string; scene: SceneDoc };
  /** The asset store's, with Prefab Mode's unsaved edits composed in. */
  materials: Record<string, MaterialDef>;
  prefabs: Record<string, PrefabDoc>;
  /** The project's current settings, as held in memory. */
  rendering: RenderingSettings;
  physics: PhysicsSettings;
  loadingScene: string | null;
}
