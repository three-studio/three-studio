import {
  capabilitiesOf,
  isAncestorOf,
  splitInstancedId,
  type EntityCapability,
  type EntityDoc,
  type SceneDoc,
} from '@three-studio/core';
import { useEditorStore } from './editorStore';
import { expandedScene } from './expansion';

/**
 * Who is selected, which subset an action should target, and what is even
 * possible — asked once, in one place.
 *
 * Six questions used to be re-asked across eight files, each with its own
 * answer: is this id document-editable, is it selected, is there exactly one,
 * what are the tops of the selection, is it locked, what does the gizmo drive.
 *
 * **Immutable, and not a second store.** `editorStore.selection` remains the one
 * place the ids live; this wraps them to reason about them and never writes.
 * That matters here specifically: this repo already carries three live
 * `SceneDoc`s and the trouble that causes, and a class owning selection state
 * beside the store would be a fourth of the same kind. Every class in this
 * codebase owns a resource it must release — this one owns nothing, which is why
 * it has a private constructor and static factories rather than `new`.
 *
 * Resolution happens against the **expanded** scene, so an id a prefab produced
 * is a real entity here even though the document has never heard of it.
 */
export class Selection {
  private readonly members: ReadonlySet<string>;

  private constructor(
    readonly ids: readonly string[],
    private readonly scene: SceneDoc,
  ) {
    this.members = new Set(ids);
  }

  /**
   * Built through the private constructor rather than `of`, so it neither reads
   * nor evicts the one-entry cache. Its scene is never consulted: every method
   * short-circuits on having no ids.
   */
  private static readonly EMPTY = new Selection([], { entities: {} } as unknown as SceneDoc);

  static empty(): Selection {
    return Selection.EMPTY;
  }

  /**
   * Memoised on the identity of `(ids, scene)`.
   *
   * Not an optimisation detail: a hierarchy row asks `has()` once per render, so
   * a fresh `Set` and a fresh filter per call would be exactly the O(n) per row
   * this class exists to remove. Immer preserves the identity of anything a
   * mutation did not touch, which makes reference equality an exact "nothing
   * moved" — the same trick `expansion.ts` uses.
   */
  static of(ids: readonly string[], scene: SceneDoc): Selection {
    if (cache && cache.ids === ids && cache.scene === scene) return cache.value;
    const value = new Selection(
      // Dropped rather than carried: an id naming nothing makes every filter
      // below lie, and the store prunes on mutation but not on a scene swap.
      ids.filter((id) => scene.entities[id] !== undefined),
      scene,
    );
    cache = { ids, scene, value };
    return value;
  }

  /** What is selected right now, against the scene as it is drawn. */
  static current(): Selection {
    return Selection.of(useEditorStore.getState().selection, expandedScene().scene);
  }

  get size(): number {
    return this.ids.length;
  }
  get isEmpty(): boolean {
    return this.ids.length === 0;
  }
  get isSingle(): boolean {
    return this.ids.length === 1;
  }
  get isMultiple(): boolean {
    return this.ids.length > 1;
  }

  /** The last one picked: the single Inspector's subject, and the gizmo's pivot. */
  get primary(): string | null {
    return this.ids.at(-1) ?? null;
  }

  has(id: string): boolean {
    return this.members.has(id);
  }

  entities(): readonly EntityDoc[] {
    return this.ids
      .map((id) => this.scene.entities[id])
      .filter((entity): entity is EntityDoc => entity !== undefined);
  }

  /**
   * Only the tops: no member that is a descendant of another member.
   *
   * Grouping a node together with its own child would move the child twice, once
   * on its own and once under its parent. Written once inside `groupSelection`
   * and never reused, though the multi-object gizmo needs exactly the same
   * subset — which is why it lives here now. Unity calls it `SelectionMode.TopLevel`.
   */
  roots(): readonly string[] {
    return this.ids.filter(
      (id) => !this.ids.some((other) => other !== id && isAncestorOf(this.scene, other, id)),
    );
  }

  /** Only the ids the document itself holds — nothing a prefab produced. */
  documentOnly(): readonly string[] {
    return this.ids.filter((id) => splitInstancedId(id) === null);
  }

  /** What a transform gesture may actually move. Godot publishes the same list. */
  transformable(): readonly string[] {
    return this.roots().filter((id) => capabilitiesOf(this.scene, id).has('translate'));
  }

  /**
   * What a reparent may actually move: the tops, minus what is locked and minus
   * what a prefab produced.
   *
   * A sibling of `transformable()`, and named for the same reason — the filter
   * belongs here rather than in each command. Note that the tree layer does *not*
   * refuse a locked entity: a lock is a capability, not a rule about structure,
   * and `capabilities.ts` says so at the top. Mixing the two would make a
   * miscomputed capability able to corrupt a document.
   */
  reparentable(): readonly string[] {
    return this.roots().filter(
      (id) => splitInstancedId(id) === null && capabilitiesOf(this.scene, id).has('reparent'),
    );
  }

  /**
   * True only when **every** member can. Blender's `poll()`, as an intersection.
   *
   * Intersection rather than union on purpose: a mixed selection with one locked
   * object cannot be moved. Unity does the same, and it is far less surprising
   * than silently moving "all but one".
   *
   * An empty selection answers `false` to everything. An intersection over
   * nothing is vacuously true, which would have every menu entry enabled with
   * nothing selected.
   */
  can(capability: EntityCapability): boolean {
    if (this.isEmpty) return false;
    return this.ids.every((id) => capabilitiesOf(this.scene, id).has(capability));
  }

  equals(other: Selection): boolean {
    if (other === this) return true;
    if (other.ids.length !== this.ids.length) return false;
    return this.ids.every((id) => other.members.has(id));
  }
}

let cache: { ids: readonly string[]; scene: SceneDoc; value: Selection } | null = null;
