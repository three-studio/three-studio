import {
  capabilitiesOf,
  componentsOf,
  findComponentById,
  type ComponentDoc,
  type ComponentType,
  type EntityCapability,
  type EntityDoc,
  type SceneDoc,
} from '@three-studio/core';
import { removeComponent, setComponentNestedField } from '../commands/sceneCommands';
import { expandedScene } from '../state/expansion';

/**
 * What the Inspector edits, whether that is one entity or forty.
 *
 * Godot's `MultiNodeEdit` and Unity's `serializedObject`: an object that looks
 * like a single thing and quietly fans each read and write out to however many
 * are behind it. The panel asks for a value and is told whether the targets
 * agree; it never learns how many there are.
 *
 * That is what keeps multi-object editing from being a rewrite. The declarative
 * layer — `COMPONENT_SCHEMAS`, the field specs — does not change at all, and
 * neither does the Tweakpane plumbing. Phase 4 ships this interface and
 * `SingleTarget`; `MultiTarget` is phase 8, and it fits behind the same shape.
 */
export interface EntityTarget {
  /** Entity-level values: `['name']`, `['visible']`, `['transform','position']`. */
  read(path: readonly string[]): Reading;
  write(path: readonly string[], value: unknown, options?: WriteOptions): void;
  /** One per component the panel should draw, in the order it should draw them. */
  components(): readonly ComponentTarget[];
  /** True only if every entity behind this target can. See `Selection.can`. */
  can(capability: EntityCapability): boolean;
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
  read(path: readonly string[]): Reading;
  write(path: readonly string[], value: unknown, options?: WriteOptions): void;
  remove(): void;
}

export interface Reading {
  value: unknown;
  /** True when the targets disagree — the "—" Unity and Unreal both show. */
  mixed: boolean;
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
 * One entity, which is every case until phase 8.
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

  read(path: readonly string[]): Reading {
    return { value: readPath(this.entity, path), mixed: false };
  }

  write(): void {
    // Entity-level writes go through their own named commands — `renameEntity`,
    // `setEntityVisible`, `setTransform` — which the panel already calls. Phase
    // 8 gives this a body when a multi-target needs one door for all of them.
  }

  components(): readonly ComponentTarget[] {
    if (!this.entity) return [];
    return componentsOf(expandedScene().scene, this.entityId).map(
      (component) => new SingleComponentTarget(this.entityId, component.id, component),
    );
  }

  can(capability: EntityCapability): boolean {
    return capabilitiesOf(expandedScene().scene, this.entityId).has(capability);
  }
}

/**
 * Several entities, presented as one.
 *
 * Godot's `MultiNodeEdit` and Unity's `serializedObject` with multiple targets.
 * `read` compares the value across every entity and says whether they agree;
 * `write` writes all of them in one transaction, so editing a field is one undo
 * step however many objects are behind it.
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

  read(path: readonly string[]): Reading {
    return compare(this.entities.map((entity) => readPath(entity, path)));
  }

  write(): void {
    // Same as `SingleTarget`: entity-level writes go through their own named
    // commands, which the panel calls directly.
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

  can(capability: EntityCapability): boolean {
    const entities = this.entities;
    if (entities.length === 0) return false;
    // An intersection, like `Selection.can`: one member that cannot stops all.
    const scene = expandedScene().scene;
    return this.entityIds.every((id) => capabilitiesOf(scene, id).has(capability));
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

  read(path: readonly string[]): Reading {
    return compare(this.each().map(({ component }) => readPath(component, path)));
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

/**
 * One reading from many values.
 *
 * `mixed` is what the panel shows a dash for. Compared by JSON rather than by
 * identity, because a colour is an object and two equal colours are two objects —
 * comparing references would report every field as mixed.
 */
function compare(values: readonly unknown[]): Reading {
  const first = values[0];
  if (values.length <= 1) return { value: first, mixed: false };

  const encoded = JSON.stringify(first);
  const mixed = values.some((value) => JSON.stringify(value) !== encoded);
  return { value: first, mixed };
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

  read(path: readonly string[]): Reading {
    return { value: readPath(this.live, path), mixed: false };
  }

  write(path: readonly string[], value: unknown, options?: WriteOptions): void {
    setComponentNestedField(this.entityId, this.componentId, path, value, options);
  }

  remove(): void {
    removeComponent(this.entityId, this.componentId);
  }
}
