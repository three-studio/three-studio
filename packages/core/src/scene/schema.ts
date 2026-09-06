/**
 * The scene document: the single source of truth for everything the user
 * builds. Three.js objects are a *view* of this data, never the other way
 * round — which is what makes undo, save/load, play-mode snapshots and the web
 * export fall out for free.
 *
 * What is declared here is the document: the union of every component type,
 * the entity, the tables the two are stored in, and the environment around
 * them. What a *particular* component is lives in `components/<type>/schema.ts`
 * and arrives below — a slice cannot import this file, because this file
 * imports every slice, so the shared vocabulary they are written in sits lower
 * again, in `primitives.ts`, `geometry.ts` and `material.ts`.
 *
 * All of it is re-exported, so that everything which reads a scene goes on
 * importing from one place and none of the twelve moves cost a single call
 * site. This is the door; the files behind it are an arrangement, not an API.
 *
 * Everything here must stay JSON-serialisable and structurally cloneable.
 */

import type { AudioListenerComponent } from '../components/audioListener/schema';
import type { AudioSourceComponent } from '../components/audioSource/schema';
import type { CameraComponent } from '../components/camera/schema';
import type { ColliderComponent } from '../components/collider/schema';
import type { LightComponent } from '../components/light/schema';
import type { MeshComponent } from '../components/mesh/schema';
import type { ModelComponent } from '../components/model/schema';
import type { ParticleEmitterComponent } from '../components/particleEmitter/schema';
import type { PlayerControllerComponent } from '../components/playerController/schema';
import type { PrefabInstanceComponent } from '../components/prefabInstance/schema';
import type { RigidBodyComponent } from '../components/rigidbody/schema';
import type { ScriptComponent } from '../components/script/schema';
import type { WaterComponent } from '../components/water/schema';
import type { Hex, Transform, Vec3 } from './primitives';

// --- the shared vocabulary --------------------------------------------------

export type { GeometryDef, GeometryKind } from './geometry';
export type { MaterialDef, MaterialSide, TextureWrap } from './material';
export { MATERIAL_SIDE_LABELS, TEXTURE_WRAP_LABELS } from './material';
export type { ComponentBase, Hex, Transform, Vec2, Vec3 } from './primitives';

/*
 * One slice per component type — and beside each union, a label for each of its
 * members. A `*_LABELS` is a **total** `Record`, so a member added to the union
 * above it does not compile until it has a name; `optionsFrom` turns one into
 * the choices a control offers, in the order the record is written. The editor
 * imports these rather than re-listing them, which is what it used to do, in a
 * Tweakpane literal, unchecked. `GEOMETRY_LABELS` has always been this shape.
 */

export type { AudioListenerComponent } from '../components/audioListener/schema';
export type {
  AudioBus,
  AudioSourceComponent,
  DistanceModel,
} from '../components/audioSource/schema';
export {
  AUDIO_BUSES,
  AUDIO_BUS_LABELS,
  DISTANCE_MODEL_LABELS,
} from '../components/audioSource/schema';
export type { CameraComponent, CameraProjection } from '../components/camera/schema';
export { CAMERA_PROJECTION_LABELS } from '../components/camera/schema';
export type { ColliderComponent, ColliderShape } from '../components/collider/schema';
export { COLLIDER_SHAPE_LABELS } from '../components/collider/schema';
export type { LightComponent, LightKind, ShadowSettings } from '../components/light/schema';
export type { MeshComponent } from '../components/mesh/schema';
export type { ModelComponent } from '../components/model/schema';
export type {
  EmitterShape,
  ParticleEmitterComponent,
} from '../components/particleEmitter/schema';
export { EMITTER_SHAPE_LABELS } from '../components/particleEmitter/schema';
export type {
  PlayerControllerComponent,
  PlayerControllerMode,
} from '../components/playerController/schema';
export { PLAYER_CONTROLLER_MODE_LABELS } from '../components/playerController/schema';
export type {
  PrefabInstanceComponent,
  PrefabOverride,
} from '../components/prefabInstance/schema';
export type { BodyType, RigidBodyComponent } from '../components/rigidbody/schema';
export { BODY_TYPE_LABELS } from '../components/rigidbody/schema';
export type { ScriptComponent, ScriptPropValue } from '../components/script/schema';
export type { WaterComponent, WaterSunSource } from '../components/water/schema';

// --- the document -----------------------------------------------------------

export type ComponentDoc =
  | MeshComponent
  | ModelComponent
  | LightComponent
  | CameraComponent
  | RigidBodyComponent
  | ColliderComponent
  | AudioSourceComponent
  | AudioListenerComponent
  | ScriptComponent
  | PrefabInstanceComponent
  | PlayerControllerComponent
  | WaterComponent
  | ParticleEmitterComponent;

export type ComponentType = ComponentDoc['type'];

/** Narrow a component union member by its `type` tag. */
export type ComponentOfType<T extends ComponentType> = Extract<ComponentDoc, { type: T }>;

// --- entities and scene -----------------------------------------------------

export interface EntityDoc {
  id: string;
  name: string;
  parent: string | null;
  /** Explicit ordering; the hierarchy panel renders in this order. */
  children: string[];
  transform: Transform;
  visible: boolean;
  /** Excluded from picking and locked against gizmo edits. */
  locked: boolean;
}

/**
 * Every component in the document, by type, then by entity, then by its own id.
 *
 * `EntityDoc.components` was an array, and an array answers none of the
 * questions asked of it: "every light" was a walk of the whole entity table, an
 * override named a component by its *position* (B10), and touching one field
 * changed the identity of the array, so the binder rebuilt every non-mesh
 * component of the entity (B9).
 *
 * Each level earns its place. **Type first** — `Object.keys(components.light)`
 * is the query that motivated the phase. **Entity second** — deleting, cloning
 * or instancing an entity moves one key per type rather than one per component.
 * **Component id last** — the identity phase 3 established, which is what a
 * prefab override names; keying by a slot index would be a position again, and
 * would reopen B10 for any entity carrying two components of one type (ADR-0003).
 *
 * One shape for all eleven types, singletons included. "One mesh per entity" is
 * a rule the commands keep, exactly as it was when the array kept none.
 */
export type ComponentTables = {
  [K in ComponentType]: Record<string, Record<string, ComponentOfType<K>>>;
};

/**
 * What the scene looks like before anything is placed in it: the sky, the light
 * that comes off it, and the air between the camera and what it sees.
 *
 * A property of the scene rather than a component on an entity — Godot's
 * `WorldEnvironment` is the other model, and it was rejected because the
 * environment is not a thing placed in the scene.
 */
/**
 * An analytic sky, in place of a photographed one.
 *
 * The Preetham daylight model, which is what three's `SkyMesh` implements and
 * what Unity's procedural skybox and Unreal's SkyAtmosphere are. It costs no
 * asset at all and it can be pointed at an hour of the day, which no
 * photograph can — the price is that it is a clear-sky model, so it has no
 * weather beyond the cloud layer below.
 *
 * A sub-object rather than eleven more fields on the environment, for the
 * reason `ShadowSettings` is one: they are read and written together, and the
 * migration merges them a level deeper in one place instead of eleven.
 */
export interface SkySettings {
  /** Degrees above the horizon. Below zero is night. */
  elevation: number;
  /** Degrees around it. Turns the sun, where `rotation` turns an image. */
  azimuth: number;
  /** Haze. 2 is a clear day; above 10 reads as smog. */
  turbidity: number;
  /** How blue the sky is — the strength of the short-wavelength scattering. */
  rayleigh: number;
  /** Size of the glow around the sun. */
  mieCoefficient: number;
  /** How tightly that glow hugs the sun. */
  mieDirectionalG: number;
  /**
   * Whether the solar disc is drawn.
   *
   * Only in the sky as seen. The capture that lights the scene never has it:
   * the disc is a handful of very bright pixels, and the blur chain that makes
   * a radiance map turns them into a ring across the whole upper hemisphere —
   * which is what `SkyMesh` documents turning it off for.
   */
  sunDisc: boolean;
  cloudCoverage: number;
  cloudDensity: number;
  cloudScale: number;
  cloudElevation: number;
  /**
   * How fast the cloud layer drifts.
   *
   * A plain rate now, with no opinion about when it applies: the shader
   * multiplies it by the simulation's clock, so a stopped viewport and a paused
   * game hold the clouds still without this setting knowing either exists. See
   * `StudioTime` in the runtime.
   */
  cloudSpeed: number;
}

/** A flat colour, an equirectangular texture, or the analytic sky. */
export type BackgroundMode = 'color' | 'texture' | 'sky';

export const BACKGROUND_MODE_LABELS: Record<BackgroundMode, string> = {
  color: 'Colour',
  texture: 'Texture',
  sky: 'Sky',
};

/** Where image-based lighting comes from. */
export type EnvironmentMode = 'none' | 'background' | 'texture';

export const ENVIRONMENT_MODE_LABELS: Record<EnvironmentMode, string> = {
  none: 'None',
  background: 'Background',
  texture: 'Texture',
};

/** Linear fog ramps between two distances; exponential has no far edge. */
export type FogMode = 'linear' | 'exponential';

export const FOG_MODE_LABELS: Record<FogMode, string> = {
  linear: 'Linear',
  exponential: 'Exponential',
};

export interface EnvironmentDef {
  /**
   * A flat colour, an equirectangular texture, or the analytic sky.
   *
   * `background` keeps its value whichever is chosen, so switching back does
   * not lose the colour — and the same is true of `backgroundTexture` and
   * `sky`. Nothing here is cleared by choosing something else.
   */
  backgroundMode: BackgroundMode;
  background: Hex;
  /** Asset id of an equirectangular image — HDR, EXR or PNG. */
  backgroundTexture: string | null;
  /**
   * How much of the background's own detail is thrown away, 0 to 1.
   *
   * Blurring the sky and leaving the reflections sharp is the standard way to
   * put a subject in front of an environment without the environment reading
   * as a photograph behind it.
   */
  backgroundBlur: number;
  /** Multiplies the background only. The light it casts is `environmentIntensity`. */
  backgroundIntensity: number;

  /**
   * Where image-based lighting comes from — what every surface reflects and is
   * lit by, and the single biggest change to how a scene reads.
   *
   * `background` reuses whatever the background already is, which is the usual
   * arrangement and costs one prefiltered radiance map instead of two. `texture`
   * names its own image, which is how a small map dedicated to the lighting is
   * paired with a large one for the sky: the prefiltering throws away that
   * resolution anyway, so only the background ever needs it.
   */
  environmentMode: EnvironmentMode;
  environmentTexture: string | null;
  environmentIntensity: number;

  /**
   * Radians about Y, turning the background and the lighting together.
   *
   * three keeps `backgroundRotation` and `environmentRotation` apart and every
   * editor that exposes either exposes one — letting the sky and the light it
   * casts disagree is a bug nobody would think to look for. Without this the
   * only way to move the sun is to re-export the image.
   */
  rotation: number;

  sky: SkySettings;

  fogEnabled: boolean;
  fogColor: Hex;
  /**
   * Linear fog ramps between two distances and is easy to place exactly;
   * exponential has no far edge, which is what makes a horizon rather than a
   * wall. `fogNear`/`fogFar` serve the first, `fogDensity` the second.
   */
  fogMode: FogMode;
  fogNear: number;
  fogFar: number;
  fogDensity: number;
}

export interface SceneDoc {
  /** Bumped whenever the shape changes; `deserializeScene` migrates or rejects. */
  version: number;
  id: string;
  name: string;
  /**
   * Flat map rather than a nested tree: reparenting is O(1), immer patches stay
   * shallow, and a subset of entities can be loaded without walking a tree.
   */
  entities: Record<string, EntityDoc>;
  /** See `ComponentTables`. Entities hold identity and place; this holds the rest. */
  components: ComponentTables;
  rootOrder: string[];
  environment: EnvironmentDef;
}
