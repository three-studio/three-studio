/*
 * The project's collision layers, and the one rule of the matrix between them.
 *
 * A file of its own because the rule has three readers — the running world's
 * collision groups, the checkboxes of Project Settings and the engine's
 * warnings — and is written once, here.
 */
import { isRecord } from '../conform';

/** The layer every collider starts on, and the one a collider naming a removed layer collides as. */
export const DEFAULT_LAYER_ID = 'default';

/** Rapier's ceiling: its collision groups are sixteen bits of membership and sixteen of filter. */
export const MAX_COLLISION_LAYERS = 16;

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

/**
 * A new table in which the two layers touch or part, for Project Settings'
 * draft.
 *
 * Ticked, each id leaves the other's list. Unticked, the later layer joins the
 * earlier one's, unless the two already part: one side, always the same, so a
 * diff of `project.json` shows one line per checkbox.
 */
export function setLayersTouch(
  layers: readonly CollisionLayer[],
  a: string,
  b: string,
  touch: boolean,
): CollisionLayer[] {
  if (touch) {
    return layers.map((layer) => {
      const other = layer.id === a ? b : layer.id === b ? a : null;
      return other === null ? layer : { ...layer, ignores: layer.ignores.filter((id) => id !== other) };
    });
  }
  if (!layersTouch(layers, a, b)) return [...layers];
  const index = (id: string) => layers.findIndex((layer) => layer.id === id);
  const [earlier, later] = index(a) <= index(b) ? [a, b] : [b, a];
  return layers.map((layer) => (layer.id === earlier ? { ...layer, ignores: [...layer.ignores, later] } : layer));
}

/**
 * Why the table cannot be saved, or `null` when it can.
 *
 * A Collider's Layer row lists the layers by name, so a name left empty
 * shows as nothing, and two alike would read as one: choosing the second
 * would write the first.
 */
export function layerNamesProblem(layers: readonly CollisionLayer[]): string | null {
  const seen = new Set<string>();
  for (const layer of layers) {
    const name = layer.name.trim();
    if (name === '') return 'Every layer needs a name.';
    if (seen.has(name)) return `Two layers are named "${name}": a Collider's Layer lists them by name.`;
    seen.add(name);
  }
  return null;
}

/** The layer a collider naming this id is on: its own, or Default once the table no longer has it. */
function layerOf(layers: readonly CollisionLayer[], id: string): CollisionLayer {
  return (
    layers.find((layer) => layer.id === id) ??
    layers.find((layer) => layer.id === DEFAULT_LAYER_ID) ??
    createDefaultLayer()
  );
}

/**
 * A table that arrived from elsewhere — a project file, a settings patch, a
 * launch — read entry by entry.
 *
 * Not through `conform`, which takes an array as a tuple of the model's
 * length: a table of three sent where the model held one came back as Default
 * alone.
 *
 * An entry is kept when it is an object whose id is a string, neither empty nor
 * seen before; a name that is not a string reads as its id. Default comes
 * first, named as its factory names it, and is added when missing; the first
 * sixteen are kept. What a layer ignores keeps the ids of the table's layers.
 */
export function conformLayers(value: unknown): CollisionLayer[] {
  const entries: readonly unknown[] = Array.isArray(value) ? value : [];
  const read: CollisionLayer[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const { id, name, ignores } = entry;
    if (typeof id !== 'string' || id === '' || read.some((layer) => layer.id === id)) continue;
    read.push({
      id,
      name: typeof name === 'string' ? name : id,
      ignores: Array.isArray(ignores) ? ignores.filter((other): other is string => typeof other === 'string') : [],
    });
  }

  const stored = read.find((layer) => layer.id === DEFAULT_LAYER_ID);
  const table = [
    { ...createDefaultLayer(), ignores: stored?.ignores ?? [] },
    ...read.filter((layer) => layer !== stored),
  ].slice(0, MAX_COLLISION_LAYERS);
  const ids = new Set(table.map((layer) => layer.id));
  return table.map((layer) => ({ ...layer, ignores: layer.ignores.filter((other) => ids.has(other)) }));
}
