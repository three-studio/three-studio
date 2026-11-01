/*
 * The project's collision layers, and the one rule of the matrix between them.
 *
 * A file of its own because the rule has three readers — the running world's
 * collision groups, the checkboxes of Project Settings and the engine's
 * warnings — and is written once, here.
 */

/** The layer every collider starts on, and the one a collider naming a removed layer collides as. */
export const DEFAULT_LAYER_ID = 'default';

/** One collision layer of the project. */
export interface CollisionLayer {
  /** What a collider names. Never shown, never reused, and not a bit: the running world assigns those. */
  id: string;
  /** What the Inspector and the matrix show. Unique in the table. */
  name: string;
  /**
   * Ids of the layers it passes through. Two layers touch unless either lists
   * the other, so the matrix is stored as what passes through and a new layer
   * meets everything, as in Unity and Godot.
   */
  ignores: string[];
}

/** Every project's first layer, which can be neither removed nor renamed. */
export function createDefaultLayer(): CollisionLayer {
  return { id: DEFAULT_LAYER_ID, name: 'Default', ignores: [] };
}

/**
 * Whether colliders on these two layers meet: neither lists the other.
 *
 * Either side is enough to part them, so a pair hand-edited on one side only
 * still reads. A layer may list itself — debris that passes through debris. An
 * id the table does not hold reads as Default, as the world builds a collider
 * that names one.
 */
export function layersTouch(layers: readonly CollisionLayer[], a: string, b: string): boolean {
  const first = layerOf(layers, a);
  const second = layerOf(layers, b);
  return !first.ignores.includes(second.id) && !second.ignores.includes(first.id);
}

/** The layer a collider naming this id is on: its own, or Default once the table no longer has it. */
function layerOf(layers: readonly CollisionLayer[], id: string): CollisionLayer {
  return (
    layers.find((layer) => layer.id === id) ??
    layers.find((layer) => layer.id === DEFAULT_LAYER_ID) ??
    createDefaultLayer()
  );
}
