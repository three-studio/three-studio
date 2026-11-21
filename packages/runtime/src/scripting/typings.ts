import { schemaTypeText, type CoreRegistries, type Registry, type ScriptMembersId } from '@three-studio/core';
import type { ScriptMembersDefinition } from './members';
import type { Behaviour, ScriptMembers } from './ScriptApi';

/*
 * `@three-studio/runtime` as a project's scripts see it, as text.
 *
 * A user's project cannot resolve `three` or `@three-studio/core`, so this is
 * not the runtime's own declarations narrowed by a compiler — it is a
 * deliberately smaller contract: `Object3D` becomes `any`, three's vectors the
 * fields and the two methods a script writes them with. Which is exactly why
 * it has to be checked against the real thing rather than trusted;
 * `apps/desktop/test/scriptTypings.test.ts` compiles what this produces against
 * `ScriptApi` and fails on the first divergence. It found two: the property
 * vocabulary was missing `vec2` altogether, and its `vec3` had lost the
 * `min`/`max`/`step` a slider needs.
 *
 * The kernel's half is here; what a feature gives scripts is its
 * contribution's to publish (`ScriptMembersDefinition`), beside the members it
 * installs.
 */

/** The types the kernel's members name. */
const KERNEL_TYPES = `  export type ScriptPropertyDef =
    | { type: 'number'; default?: number; min?: number; max?: number; step?: number; label?: string }
    | { type: 'boolean'; default?: boolean; label?: string }
    | { type: 'string'; default?: string; label?: string }
    | { type: 'color'; default?: string; label?: string }
    | { type: 'vec2'; default?: [number, number]; min?: number; max?: number; step?: number; label?: string }
    | { type: 'vec3'; default?: [number, number, number]; min?: number; max?: number; step?: number; label?: string }
    | { type: 'enum'; options: readonly (string | { value: string; label: string })[]; default?: string; label?: string }
    | { type: 'entity'; label?: string }
    | { type: 'asset'; kind?: string; label?: string };

  export interface StudioInput {
    isDown(code: string): boolean;
    isAnyDown(...codes: string[]): boolean;
    readonly pointerLocked: boolean;
    consumeMouseDelta(): { x: number; y: number };
    consumeWheel(): number;
  }

  /** A scene being fetched. */
  export interface SceneLoadHandle {
    readonly path: string;
    /** 0 to 1 across the assets the scene needs. */
    readonly progress: number;
    /** Settles when it could be shown. */
    readonly ready: Promise<void>;
    readonly activated: boolean;
    /** Shows it, waiting for \`ready\` first if it has to. */
    activate(): Promise<void>;
    cancel(): void;
  }

  /** Moving between scenes. Both take a scene's name or its id. */
  export interface SceneApi {
    /** The running scene's name. Hold its id instead if a rename must not break this. */
    readonly current: string | null;
    /** Starts fetching, without showing. Poll \`progress\`, then \`activate()\`. */
    load(scene: string): SceneLoadHandle;
    /** Fetches and shows, for a transition with nothing to display meanwhile. */
    go(scene: string): Promise<void>;
  }

  /** A point, a direction or a velocity: metres, metres per second. three's \`Vector3\` is one. */
  export interface Vec3Like { x: number; y: number; z: number }
  /** A rotation. three's \`Quaternion\` is one. */
  export interface QuatLike { x: number; y: number; z: number; w: number }

  /** A vector written in place: \`this.transform.position.x += 1\`. three's \`Vector3\` is one. */
  export interface Vec3 {
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): this;
    copy(vector: Readonly<Vec3Like>): this;
  }

  /** Angles in radians about x, y and z, written in place. three's \`Euler\` is one. */
  export interface Euler {
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): this;
    copy(euler: Euler): this;
  }

  /** A rotation written in place. three's \`Quaternion\` is one. */
  export interface Quat {
    x: number;
    y: number;
    z: number;
    w: number;
    set(x: number, y: number, z: number, w: number): this;
    copy(quaternion: Readonly<QuatLike>): this;
  }

  /**
   * Where an entity is: the vectors the world draws it with, local to its parent, written in
   * place to move it. A dynamic body, or the player, is put where it is written and keeps its
   * speed; a kinematic one moves there at the next tick, carrying what rests on it; a fixed
   * one's collider stays where it is, and so does a collider riding an ancestor's body.
   */
  export interface EntityTransform {
    /** Local to its parent, in metres. */
    readonly position: Vec3;
    /** Local, in radians, kept in step with \`quaternion\`. */
    readonly rotation: Euler;
    readonly quaternion: Quat;
    readonly scale: Vec3;
    /** Where it is in the world, written into \`target\`, which comes back. */
    getWorldPosition<T extends Vec3Like>(target: T): T;
    /** How it is turned in the world, written into \`target\`, which comes back. */
    getWorldQuaternion<T extends QuatLike>(target: T): T;
    /** The way its local +Z points in the world, unit length, written into \`target\`, which comes back. */
    getWorldDirection<T extends Vec3Like>(target: T): T;
    /** Turns it so its local +Z faces a point in the world. */
    lookAt(point: Readonly<Vec3Like>): void;
  }

  /** An entity of the running game: one handle per entity, the same each time it is asked for. */
  export interface Entity {
    readonly id: string;
    readonly name: string;
    /** False from the moment it is destroyed. */
    readonly alive: boolean;
    /** The entity it hangs under, or null at the top. */
    readonly parent: Entity | null;
    readonly transform: EntityTransform;
    /**
     * Its three.js object, outside what this API keeps stable. Its model's materials are this
     * game's own copies; the model's geometry and textures are the project's, shared with the
     * editor and read-only: written, a change shows in the edit view after Stop.
     */
    readonly object3D: any;

    /** Its first component of \`type\`, frozen: a change is a copy handed to \`setComponent\`. Null when it holds none. */
    getComponent<K extends keyof ComponentTypes>(type: K): ComponentTypes[K] | null;
    /**
     * Puts a changed copy in place of the component under its id —
     * \`setComponent({ ...light, intensity: 3 })\` — drawn from the end of the frame. False, with
     * a warning, for a component the entity does not hold or a field that does not read.
     */
    setComponent(component: ComponentTypes[keyof ComponentTypes]): boolean;
    /** Adds a component of \`type\` with what its type requires. Null, with a warning, when it does not fit. */
    addComponent<K extends keyof ComponentTypes>(type: K): ComponentTypes[K] | null;
    /** Takes a component off, from the end of the frame. False when the entity does not hold it. */
    removeComponent(component: ComponentTypes[keyof ComponentTypes]): boolean;
  }

  /** The world a script runs in. */
  export interface ScriptWorld {
    /** The entity with this id, or null: one destroyed, one not there, or a value that is no id. */
    entity(id: string): Entity | null;
  }`;

/** The class's one static, first in its body. */
const PROPERTIES = `    /** Editable in the Inspector, saved per instance with the scene. */
    static properties: Record<string, ScriptPropertyDef>;`;

/**
 * A member of `Behaviour` that is the kernel's, which no contribution gives.
 *
 * `keyof` sees no protected member, so the three helpers a script calls on
 * itself are named: the only names here written rather than derived.
 */
type KernelMember = Exclude<keyof Behaviour, keyof ScriptMembers> | 'log' | 'wait' | 'repeat';

/**
 * The kernel's half of the published `Behaviour`, a member's lines each.
 *
 * Total over the kernel's members, and that is the whole mechanism: a member
 * added to the class and forgotten here does not compile, and a name here the
 * class does not have does not compile either. Before a table did this, a
 * template literal nothing checked had fallen two members behind: `scenes` and
 * `onSceneUnload` existed on the class, were reserved against, and were
 * published nowhere.
 *
 * Its keys are the names the kernel reserves. Applying a script's properties
 * onto the instance is what makes them editable, and a property called
 * `transform` would replace the object the script is meant to move, one called
 * `log` the method — silently, leaving a script that does nothing and gives no
 * clue why.
 *
 * `null` is a member the host owns and a script may not call. The order is the
 * emitted file's, since a record keeps the order it was written in and this is
 * what somebody reads in their editor; an entry opening on a newline is how a
 * blank line between two groups survives.
 */
const KERNEL_MEMBERS: Record<KernelMember, string | null> = {
  entity: `
    /** The entity this script is attached to: the handle \`this.world.entity(its id)\` gives. */
    readonly entity: Entity;`,
  transform: `    /** Its entity's transform: write \`position\`, \`rotation\`, \`scale\` in place to move it. */
    readonly transform: EntityTransform;`,
  world: `    /** The world it runs in: other entities by id. */
    readonly world: ScriptWorld;`,
  input: `    readonly input: StudioInput;`,
  scenes: `    /** Moving between scenes. \`null\` when nothing is hosting this engine. */
    readonly scenes: SceneApi | null;`,
  time: `    /** Seconds since play started. */
    time: number;`,
  onAwake: `
    /** Set this script up alone. Other entities may not exist yet. */
    onAwake?(): void;`,
  onStart: `    /** Every script now exists. Cross-references belong here. */
    onStart?(): void;`,
  onUpdate: `    /** Once per displayed frame. */
    onUpdate?(delta: number): void;`,
  onFixedUpdate: `    /** Once per physics tick. Anything commanding a body belongs here. */
    onFixedUpdate?(step: number): void;`,
  onLateUpdate: `    /** After physics. Anything following a subject belongs here. */
    onLateUpdate?(): void;`,
  onSceneUnload: `    /** The scene is being left, and everything is still here to read. */
    onSceneUnload?(): void;`,
  onDestroy: `    onDestroy?(): void;`,
  log: `
    protected log(...args: unknown[]): void;`,
  wait: `    /** setTimeout tied to this script's lifetime. */
    protected wait(callback: () => void, ms: number): void;`,
  repeat: `    /** setInterval tied to this script's lifetime; returns a canceller. */
    protected repeat(callback: () => void, ms: number): () => void;`,
  // Called by the host after `onDestroy`. Reserved so a property cannot take
  // the name, and unpublished so a script cannot cancel its own timers early.
  cancelTimers: null,
};

/**
 * Every name a script property may not take: the kernel's members, and those
 * of each contribution. Made once per world, from the contributions it runs.
 */
export function reservedScriptNames(contributions: readonly ScriptMembersDefinition[]): ReadonlySet<string> {
  return new Set([...Object.keys(KERNEL_MEMBERS), ...contributions.flatMap(({ members }) => Object.keys(members))]);
}

/**
 * Every component type of the build, as a script reads one: from each type's
 * schema, a module's as the kernel's, so a type reaches an author's editor
 * with nothing written for it by hand.
 */
function componentTypes(components: CoreRegistries['components']): string {
  const entries = components.values().map(
    ({ id, schema }) =>
      `    ${JSON.stringify(id)}: ${schemaTypeText(schema, '    ', ['readonly id: string', `readonly type: ${JSON.stringify(id)}`])};`,
  );
  return `  /** Each component type, as a script reads one: frozen, so a change is a copy handed to \`setComponent\`. */
  export interface ComponentTypes {
${entries.join('\n')}
  }`;
}

/**
 * The declaration of `@three-studio/runtime` written into a project, so that an
 * editor of the author's own gives completion and type errors: the kernel's
 * types and each contribution's, in registration order, then `Behaviour`, the
 * kernel's members and each contribution's. Unity generates a .csproj for the
 * same reason: without it a user script is untyped text, and the editor is the
 * only place a mistake shows.
 *
 * From the registries the editor window runs, and only there: the main process
 * activates core alone and must not load three, so it cannot see what a
 * feature gives scripts. A module left out of the editor is left out of the
 * typings as it is left out of Play.
 */
export function scriptTypings(registries: {
  readonly components: CoreRegistries['components'];
  readonly scriptMembers: Registry<ScriptMembersId, ScriptMembersDefinition>;
}): string {
  const contributions = registries.scriptMembers.values();
  const types = [KERNEL_TYPES, componentTypes(registries.components), ...contributions.map(({ types }) => types)].filter(
    (block) => block !== '',
  );
  const members = [
    PROPERTIES,
    ...Object.values(KERNEL_MEMBERS).filter((member): member is string => member !== null),
    ...contributions.flatMap(({ members }) => Object.values(members)),
  ];
  return `// Generated by Three Studio. Do not edit.
declare module '@three-studio/runtime' {
${types.join('\n\n')}

  export abstract class Behaviour {
${members.join('\n')}
  }
}
`;
}
