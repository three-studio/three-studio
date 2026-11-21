import type { Registry, ScriptMembersId } from '@three-studio/core';
import type { ScriptMembersDefinition } from './members';
import type { Behaviour, ScriptMembers } from './ScriptApi';

/*
 * `@three-studio/runtime` as a project's scripts see it, as text.
 *
 * A user's project cannot resolve `three` or `@three-studio/core`, so this is
 * not the runtime's own declarations narrowed by a compiler — it is a
 * deliberately smaller contract: `Object3D` becomes `any`, an `EntityDoc`
 * becomes the two fields a script reads off it. Which is exactly why it has to
 * be checked against the real thing rather than trusted;
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

  export interface EntityHandle {
    readonly id: string;
    readonly name: string;
    readonly object: any;
  }

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
  export interface QuatLike { x: number; y: number; z: number; w: number }`;

/** The class's one static, first in its body. */
const PROPERTIES = `    /** Editable in the Inspector, saved per instance with the scene. */
    static properties: Record<string, ScriptPropertyDef>;`;

/**
 * A member of `Behaviour` that is the kernel's, which no contribution gives.
 *
 * `keyof` sees no protected member, so the four helpers a script calls on
 * itself are named: the only names here written rather than derived.
 */
type KernelMember = Exclude<keyof Behaviour, keyof ScriptMembers> | 'resolve' | 'log' | 'wait' | 'repeat';

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
    /** The entity this script is attached to. */
    readonly entity: { id: string; name: string };`,
  transform: `    /**
     * Its three.js object. Mutate \`position\`, \`rotation\`, \`scale\` to move it.
     * A dynamic body, or the player, is put there and keeps its speed; a
     * kinematic one moves there at the next tick, carrying what rests on it; a
     * fixed one's collider stays where it is, and so does a collider riding an
     * ancestor's body: it sits where the world was built.
     */
    readonly transform: any;`,
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
  resolve: `
    protected resolve(entityId: string | null | undefined): EntityHandle | null;`,
  log: `    protected log(...args: unknown[]): void;`,
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
  readonly scriptMembers: Registry<ScriptMembersId, ScriptMembersDefinition>;
}): string {
  const contributions = registries.scriptMembers.values();
  const types = [KERNEL_TYPES, ...contributions.map(({ types }) => types)].filter((block) => block !== '');
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
