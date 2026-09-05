import type { ComponentBase, Transform } from '../../scene/primitives';

/**
 * An instance of a prefab asset, held by reference.
 *
 * The scene stores one entity and this component, not a copy of the prefab's
 * contents. Unity serialises the same thing — a `PrefabInstance` plus a list of
 * modifications — and Godot's instanced scenes work the same way. The
 * alternative, writing the whole sub-tree into the scene, is what makes a
 * thousand trees a thousand copies: the file stops being reviewable, loading
 * stops being cheap, and nothing can tell two instances apart well enough to
 * batch them.
 */
export interface PrefabInstanceComponent extends ComponentBase {
  type: 'prefabInstance';
  assetId: string;
  /**
   * Per-entity changes, keyed by the id the entity has *inside* the prefab.
   *
   * Unity calls these `m_Modifications`. They are what makes an instance worth
   * having: the prefab says what a tree is, the override says this one is
   * shorter.
   */
  overrides: Record<string, PrefabOverride>;
}

export interface PrefabOverride {
  name?: string;
  visible?: boolean;
  transform?: Partial<Transform>;
  /** By component id inside the prefab entity, then by property name. */
  components?: Record<string, Record<string, unknown>>;
}
