/**
 * The scene document: the single source of truth for everything the user
 * builds. Three.js objects are a *view* of this data, never the other way
 * round — which is what makes undo, save/load, play-mode snapshots and the web
 * export fall out for free.
 *
 * Everything here must stay JSON-serialisable and structurally cloneable.
 */

import type { ComponentBase, Hex, Transform, Vec2, Vec3 } from './primitives';
import type { AudioListenerComponent } from '../components/audioListener/schema';
import type { AudioSourceComponent } from '../components/audioSource/schema';
import type { CameraComponent } from '../components/camera/schema';
import type { ColliderComponent } from '../components/collider/schema';
import type { LightComponent } from '../components/light/schema';
import type { PrefabInstanceComponent } from '../components/prefabInstance/schema';
export type { PlayerControllerComponent } from '../components/playerController/schema';
export type { RigidBodyComponent } from '../components/rigidbody/schema';
export type { ScriptComponent, ScriptPropValue } from '../components/script/schema';
import type { PlayerControllerComponent } from '../components/playerController/schema';
import type { RigidBodyComponent } from '../components/rigidbody/schema';
import type { ScriptComponent } from '../components/script/schema';

/*
 * The vocabulary is re-exported rather than declared, so that everything which
 * reads the document goes on importing it from here. What lives elsewhere is
 * what a component slice has to import without importing the union of them all
 * — see `primitives.ts` — and the types of the slices themselves.
 */
export type { ComponentBase, Hex, Transform, Vec2, Vec3 } from './primitives';
export type { AudioListenerComponent } from '../components/audioListener/schema';
export type { AudioBus, AudioSourceComponent } from '../components/audioSource/schema';
export { AUDIO_BUSES } from '../components/audioSource/schema';
export type { CameraComponent, CameraProjection } from '../components/camera/schema';
export type { ColliderComponent } from '../components/collider/schema';
export type { LightComponent, LightKind, ShadowSettings } from '../components/light/schema';
export type {
  PrefabInstanceComponent,
  PrefabOverride,
} from '../components/prefabInstance/schema';

// --- geometry ---------------------------------------------------------------

/**
 * One entry per three.js geometry class, rather than a generic "polyhedron"
 * with a shape field: the kind is what the binder switches on, what names the
 * entity and what the collider guess reads, so keeping it 1:1 with three means
 * none of those three tables needs a second lookup.
 */
export type GeometryDef =
  | {
      kind: 'box';
      width: number;
      height: number;
      depth: number;
      /** Subdivisions. Only matter under a displacement map, which moves vertices. */
      widthSegments: number;
      heightSegments: number;
      depthSegments: number;
    }
  | { kind: 'sphere'; radius: number; widthSegments: number; heightSegments: number }
  | { kind: 'plane'; width: number; height: number; widthSegments: number; heightSegments: number }
  | { kind: 'capsule'; radius: number; height: number; capSegments: number; radialSegments: number }
  | {
      kind: 'cylinder';
      radiusTop: number;
      radiusBottom: number;
      height: number;
      radialSegments: number;
    }
  | { kind: 'circle'; radius: number; segments: number }
  | { kind: 'ring'; innerRadius: number; outerRadius: number; thetaSegments: number }
  | { kind: 'torus'; radius: number; tube: number; radialSegments: number; tubularSegments: number }
  | {
      kind: 'torusKnot';
      radius: number;
      tube: number;
      tubularSegments: number;
      radialSegments: number;
      /** Winding counts. Coprime integers; anything else fails to close the knot. */
      p: number;
      q: number;
    }
  // The four solids take the same two arguments in three, so they share a shape
  // here too. `detail` subdivides towards a sphere.
  | { kind: 'tetrahedron'; radius: number; detail: number }
  | { kind: 'octahedron'; radius: number; detail: number }
  | { kind: 'dodecahedron'; radius: number; detail: number }
  | { kind: 'icosahedron'; radius: number; detail: number };

export type GeometryKind = GeometryDef['kind'];

// --- material ---------------------------------------------------------------

/**
 * How a texture repeats past the 0..1 UV range. Named after three's constants;
 * `mirror` is what stops a tiled ground from showing a hard seam.
 */
export type TextureWrap = 'repeat' | 'clamp' | 'mirror';

/** Which faces are drawn. Named because two component types now take it. */
export type MaterialSide = 'front' | 'back' | 'double';

export interface MaterialDef {
  color: Hex;
  roughness: number;
  metalness: number;
  emissive: Hex;
  emissiveIntensity: number;
  opacity: number;
  transparent: boolean;
  wireframe: boolean;
  side: MaterialSide;

  /*
   * Texture slots. All asset ids, resolved through the asset registry.
   *
   * Colour and emissive are authored in sRGB; the rest carry data (directions,
   * roughness, coverage) and must stay linear, or the values the shader reads
   * are not the values the artist painted.
   */
  /** Base colour. sRGB. */
  colorMap: string | null;
  /** Tangent-space normals. Linear. */
  normalMap: string | null;
  normalScale: number;
  /**
   * Height in the red channel, converted to a normal perturbation. Linear.
   *
   * An alternative to `normalMap`, not a companion: three takes the normal map
   * when both are set and never mixes them. Cheaper to author — a grey-scale
   * height map rather than a baked tangent-space normal — and it is also what
   * a displacement map usually looks like, so the same file often serves both.
   */
  bumpMap: string | null;
  bumpScale: number;
  /** Read from the green channel, as in glTF. Linear. */
  roughnessMap: string | null;
  /** Read from the blue channel, as in glTF. Linear. */
  metalnessMap: string | null;
  /** sRGB. */
  emissiveMap: string | null;
  /** Ambient occlusion, read from red. Linear. */
  aoMap: string | null;
  aoIntensity: number;
  /** Opacity from the red channel; needs `transparent`. Linear. */
  alphaMap: string | null;
  /**
   * Real geometry displacement: each vertex moves along its normal by the red
   * channel. Linear.
   *
   * Per *vertex*, not per pixel, so it only shows on a subdivided mesh — which
   * is why the box and plane primitives expose segment counts. A normal map
   * fakes the lighting of detail without moving anything and costs nothing;
   * displacement changes the silhouette and the shadow.
   */
  displacementMap: string | null;
  displacementScale: number;
  /** Shifts the whole surface, so a mid-grey map can push in as well as out. */
  displacementBias: number;

  /*
   * UV transform, applied to every slot of this material. It lives on the
   * three `Texture`, not the material, which is why the binder clones the
   * cached texture per material rather than sharing one instance.
   */
  tiling: Vec2;
  offset: Vec2;
  wrap: TextureWrap;
}

// --- components -------------------------------------------------------------

export interface MeshComponent extends ComponentBase {
  type: 'mesh';
  geometry: GeometryDef;
  /**
   * The embedded material, used while `materialId` is null.
   *
   * Godot's model rather than Unity's: a material starts embedded, and only
   * becomes a shared asset when the author asks for one. Unity and Unreal are
   * asset-first — a new object gets a read-only default and any change forces
   * you to create an asset — which buys consistency at the price of a file per
   * tinted cube.
   */
  material: MaterialDef;
  /**
   * Asset id of a shared material. When set it wins over `material`, and the
   * embedded value is left untouched so detaching can fall back to it.
   */
  materialId: string | null;
  castShadow: boolean;
  receiveShadow: boolean;
}

/** An imported glTF. References an asset id so instancing stays possible later. */
export interface ModelComponent extends ComponentBase {
  type: 'model';
  assetId: string;
  /**
   * Which node of the file this draws. `''` draws the whole thing.
   *
   * A path of child indices from the loaded root — `'2.0.1'` — which is what
   * lets `unpackModel` turn one imported file into one entity per node, each
   * selectable, transformable and given a material of its own. Unity's leaf
   * carries a `MeshFilter` pointing at a sub-asset of the model file; this is
   * the same arrangement with the same reason behind it.
   *
   * Indices rather than the name, because a name is unique in neither glTF nor
   * FBX and `clone(true)` preserves child order. The path is relative to the
   * tree **as the import settings dress it**, which both the unpack and the
   * runtime see because both go through `ModelCache` — but changing those
   * settings afterwards can move a node, which is what `nodeName` is for.
   */
  nodePath: string;
  /** The name of the node at `nodePath`, to fall back on when the tree moved. */
  nodeName: string;
  /**
   * Asset id of a shared material drawn in place of the file's own.
   *
   * `null` keeps what the file shipped with, which is what every model did
   * before this existed. Whole-file or per-node alike: an unpacked part is one
   * node, so setting it there is "this part's material" — the one thing an
   * imported model had no way at all to express.
   */
  materialId: string | null;
  castShadow: boolean;
  receiveShadow: boolean;
}

/**
 * Where a water surface takes its sun from.
 *
 * `'sky'` is the scene's own analytic sun — the one `SkySettings` already
 * describes — and is the default, because a scene that has a sky has exactly one
 * place the light should come from. `'custom'` is the two fields below. Anything
 * else is a light entity's id, and a light that goes away falls back to the sky
 * rather than leaving the water lit from nowhere.
 *
 * One field and one control rather than a mode plus a reference, because they
 * are one question — *which* sun — and splitting it would let the document hold
 * a mode and an id that disagree.
 */
export type WaterSunSource = string;

/**
 * A flat reflective water surface.
 *
 * Deliberately not a `mesh` with a material: the reflection is a second render
 * of the scene from a mirrored camera, which no `MaterialDef` can describe, and
 * the geometry is a plane because a reflector mirrors about one flat plane.
 *
 * It is the `WaterMesh` addon's parameter list, minus what only its WebGL twin
 * has. `textureWidth`/`textureHeight` are `resolutionScale` here;
 * `clipBias` and `eye` are internals; `time` belongs to the one clock and not to
 * a component.
 */
export interface WaterComponent extends ComponentBase {
  type: 'water';
  /** Plane only — see the note above. */
  geometry: Extract<GeometryDef, { kind: 'plane' }>;
  /** The normal map the ripples are read from. A built-in one is used until set. */
  normalMapId: string | null;
  waterColor: Hex;
  sunSource: WaterSunSource;
  /** Used when `sunSource` is `'custom'`. Points from the surface at the sun. */
  sunDirection: Vec3;
  /** Used when `sunSource` is `'custom'`. */
  sunColor: Hex;
  /** Opacity of the whole surface. */
  alpha: number;
  /** Spatial frequency of the ripples. Larger is finer. */
  size: number;
  /**
   * How fast the water runs. `0` holds it still.
   *
   * Per surface, on top of the scene's timescale: a millpond and a torrent can
   * sit in one scene, and Pause still stops both.
   */
  speed: number;
  /** Which way it runs, in radians. `0` is the addon's own look. */
  direction: number;
  /**
   * How sharp the waves read. Low is a swell, high is a chop.
   *
   * It scales the horizontal components of the wave normal; `1.5` is the value
   * three's `WaterMesh` hard-codes.
   */
  choppiness: number;
  /** How far the reflection is pushed around by those ripples. */
  distortionScale: number;
  /**
   * Reflection resolution, as a fraction of the viewport.
   *
   * The one knob that cannot be written in place: `WaterMesh` hands it to its
   * reflector while building the shader, so changing it rebuilds the surface.
   */
  resolutionScale: number;
  side: MaterialSide;
  fog: boolean;
}

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
  | WaterComponent;

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
  /**
   * Streaming cell. Unused by the MVP, which loads whole scenes, but present
   * from the start so open-world streaming is a load-time filter rather than a
   * schema migration.
   */
  chunk?: string;
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
 * would reopen B10 for any entity carrying two components of one type (ADR-16).
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

export interface EnvironmentDef {
  /**
   * A flat colour, an equirectangular texture, or the analytic sky.
   *
   * `background` keeps its value whichever is chosen, so switching back does
   * not lose the colour — and the same is true of `backgroundTexture` and
   * `sky`. Nothing here is cleared by choosing something else.
   */
  backgroundMode: 'color' | 'texture' | 'sky';
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
  environmentMode: 'none' | 'background' | 'texture';
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
  fogMode: 'linear' | 'exponential';
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
