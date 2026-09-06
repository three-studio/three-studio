import {
  componentsOf,
  findComponentById,
  type ComponentDoc,
  type ComponentType,
  type EntityDoc,
  type SceneDoc,
} from '@three-studio/core';
import { removeComponent, setComponentNestedField } from '../commands/sceneCommands';
import { expandedScene } from '../state/expansion';

/**
 * What the Inspector edits, whether that is one entity or forty.
 *
 * Godot's `MultiNodeEdit` and Unity's `serializedObject`: an object that looks
 * like a single thing and quietly fans out to however many are behind it. The
 * panel asks it for components and never learns how many entities there are,
 * which is what keeps multi-object editing from being a rewrite — the
 * declarative layer and the Tweakpane plumbing do not change at all.
 *
 * One method, and it was four. `read` and `write` at this level had no caller:
 * a name, a visibility and a transform are per-entity, so the panel calls
 * `renameEntity`, `setEntityVisible` and `setTransform` by name and both
 * implementations of `write` here were documented no-ops waiting for a phase
 * that has since arrived. `can` was a second copy of `Selection.can`, which is
 * the one everything actually asks.
 */
export interface EntityTarget {
  /** One per component the panel should draw, in the order it should draw them. */
  components(): readonly ComponentTarget[];
}

/**
 * One component of the target.
 *
 * A component rather than a path into the entity, because *which* component is
 * the part that differs between one target and many: a single entity names it
 * by id, and a multi-target has to pair components of the same type across
 * entities whose ids all differ. Keeping that behind this object is what lets
 * the panel stay identical for both.
 */
export interface ComponentTarget {
  readonly type: ComponentType;
  /**
   * The component as the panel should show it — for a single target, the one
   * entity's; for many, the first, whose shape decides which fields exist.
   */
  readonly representative: ComponentDoc;
  /**
   * The value the panel shows: for a single target the entity's own, for many
   * the first one's.
   *
   * It used to be a `{ value, mixed }`, with `mixed` true when the targets
   * disagreed — the dash Unity and Unreal both show. Nothing ever read it: the
   * panel took `.value` and dropped the rest, so the dash was specified and
   * never drawn. Drawing it is a feature to write rather than a field to leave
   * waiting, and not a small one — Tweakpane fixes a row's label when the row
   * is bound, so a dash that comes and goes with an edit needs somewhere to
   * live that a refresh can reach.
   */
  read(path: readonly string[]): unknown;
  write(path: readonly string[], value: unknown, options?: WriteOptions): void;
  remove(): void;
}

export interface WriteOptions {
  coalesceKey?: string;
}

/** Reads a nested value, `undefined` for any path that does not resolve. */
export function readPath(source: unknown, path: readonly string[]): unknown {
  let current: unknown = source;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * One entity, which is every case but a multiple selection.
 *
 * Reads go through the **expanded** scene rather than the document: a prefab
 * instance's contents are drawn and selectable, and reading from the document
 * alone leaves the panel blank for anything inside one.
 */
export class SingleTarget implements EntityTarget {
  constructor(private readonly entityId: string) {}

  private get entity(): EntityDoc | undefined {
    return expandedScene().scene.entities[this.entityId];
  }

  components(): readonly ComponentTarget[] {
    if (!this.entity) return [];
    return componentsOf(expandedScene().scene, this.entityId).map(
      (component) => new SingleComponentTarget(this.entityId, component.id, component),
    );
  }
}

/**
 * Several entities, presented as one.
 *
 * Godot's `MultiNodeEdit` and Unity's `serializedObject` with multiple targets.
 * It pairs the components the selection has in common; each of those reads the
 * first entity's value and writes all of them in one transaction, so editing a
 * field is one undo step however many objects are behind it.
 *
 * `buildInspector` does not know this class exists — it only ever saw
 * `EntityTarget`, which is why phase 4 built that interface before there was
 * anything to put behind it.
 */
export class MultiTarget implements EntityTarget {
  constructor(private readonly entityIds: readonly string[]) {}

  private get entities(): EntityDoc[] {
    const scene = expandedScene().scene;
    return this.entityIds
      .map((id) => scene.entities[id])
      .filter((entity): entity is EntityDoc => entity !== undefined);
  }

  /**
   * The components the whole selection has in common, paired by type and by rank
   * within that type.
   *
   * Pairing cannot go by id — every entity's components have different ones — and
   * that is exactly why `EntityTarget` hands back component objects rather than
   * taking a path into the entity. The first entity decides the order, and a
   * component only survives if every other entity has one to match it.
   */
  components(): readonly ComponentTarget[] {
    const scene = expandedScene().scene;
    const entities = this.entities;
    const first = entities[0];
    if (first === undefined || entities.length < 2) return [];

    const rank = new Map<ComponentType, number>();
    const shared: ComponentTarget[] = [];

    for (const component of componentsOf(scene, first.id)) {
      const nth = rank.get(component.type) ?? 0;
      rank.set(component.type, nth + 1);

      const peers = entities.map((entity) => nthOfType(scene, entity.id, component.type, nth));
      // Missing on any one of them: showing a field that only some objects have
      // would write it onto the others, which is not what the author asked.
      if (peers.some((peer) => peer === undefined)) continue;

      shared.push(
        new MultiComponentTarget(
          this.entityIds.slice(0, entities.length),
          component.type,
          nth,
          component,
        ),
      );
    }

    return shared;
  }
}

class MultiComponentTarget implements ComponentTarget {
  constructor(
    private readonly entityIds: readonly string[],
    readonly type: ComponentType,
    private readonly nth: number,
    readonly representative: ComponentDoc,
  ) {}

  private each(): { entityId: string; component: ComponentDoc }[] {
    const scene = expandedScene().scene;
    const out: { entityId: string; component: ComponentDoc }[] = [];
    for (const entityId of this.entityIds) {
      const component =
        scene.entities[entityId] === undefined
          ? undefined
          : nthOfType(scene, entityId, this.type, this.nth);
      if (component) out.push({ entityId, component });
    }
    return out;
  }

  /** The first one's, re-resolved: the panel holds this object across frames. */
  read(path: readonly string[]): unknown {
    return readPath(this.each()[0]?.component, path);
  }

  write(path: readonly string[], value: unknown, options?: WriteOptions): void {
    // Writing the same value to N components lands as N patches in one entry,
    // because `setComponentNestedField` shares the coalesce key.
    for (const { entityId, component } of this.each()) {
      setComponentNestedField(entityId, component.id, path, value, options);
    }
  }

  remove(): void {
    for (const { entityId, component } of this.each()) {
      removeComponent(entityId, component.id);
    }
  }
}

/** The `nth` component of a given type on an entity, in the order it is shown. */
function nthOfType(
  scene: SceneDoc,
  entityId: string,
  type: ComponentType,
  nth: number,
): ComponentDoc | undefined {
  return Object.values(scene.components[type][entityId] ?? {})[nth] as ComponentDoc | undefined;
}

class SingleComponentTarget implements ComponentTarget {
  constructor(
    private readonly entityId: string,
    private readonly componentId: string,
    readonly representative: ComponentDoc,
  ) {}

  get type(): ComponentType {
    return this.representative.type;
  }

  /** Re-read every time: the panel holds this object across many frames. */
  private get live(): ComponentDoc | undefined {
    return findComponentById(expandedScene().scene, this.entityId, this.componentId);
  }

  read(path: readonly string[]): unknown {
    return readPath(this.live, path);
  }

  write(path: readonly string[], value: unknown, options?: WriteOptions): void {
    setComponentNestedField(this.entityId, this.componentId, path, value, options);
  }

  remove(): void {
    removeComponent(this.entityId, this.componentId);
  }
}
