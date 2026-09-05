import {
  BatchedMesh,
  Color,
  FogExp2,
  Light,
  Mesh,
  Texture,
  Vector2,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Scene,
  type SpotLight,
} from 'three/webgpu';
import type { SceneBinder } from '../src/SceneBinder';
import { resolveEntityId } from '../src/systems/identity';

/*
 * What a mode made of a document, reduced to something two modes can be
 * compared on.
 *
 * A test helper, and deliberately not shipped: nothing in production has a
 * reason to summarise a scene graph, and a summary with one caller is a summary
 * that drifts from what it summarises. It reads only the binder's public
 * surface — `root`, `poolSizes` — plus `resolveEntityId`, which is what the
 * picker reads, so the digest cannot see anything a mode could not.
 *
 * **Nothing here reads a `uuid`.** Three hands out a fresh one per object, so a
 * digest carrying one would differ between two builds of the same document and
 * prove nothing. Identity is structural instead: an object is named by the
 * entity it hangs under, and a geometry and a material by what they draw.
 */

export interface ProjectionDigest {
  /**
   * `scene.children` minus the binder's root, by name and in the order added.
   *
   * Not sorted, unlike everything below: the editor's overlays are supposed to
   * arrive in the order `EDITOR_OVERLAYS` lists them, and sorting would throw
   * away the half of that claim worth checking.
   */
  overlays: string[];
  environment: EnvironmentDigest;
  lights: LightDigest[];
  draws: DrawDigest[];
  pools: { geometries: number; materials: number };
}

export interface EnvironmentDigest {
  background: string | null;
  backgroundIntensity: number;
  backgroundRotationY: number;
  environment: string | null;
  environmentIntensity: number;
  fog: FogDigest | null;
}

export type FogDigest =
  | { mode: 'linear'; color: string; near: number; far: number }
  | { mode: 'exponential'; color: string; density: number };

export interface LightDigest {
  /** `''` for a light hanging under no entity — see `digestProjection`. */
  entityId: string;
  type: string;
  color: string;
  intensity: number;
  castShadow: boolean;
  /** `[0, 0]` for the kinds three gives no `shadow` at all: ambient, hemisphere, rect area. */
  shadowMapSize: [number, number];
  shadowBias: number;
  shadowNormalBias: number;
}

export interface DrawDigest {
  entityId: string;
  /**
   * Three's own `Object3D.type`, which is `'Mesh'` for a `BatchedMesh` as well
   * — that class does not override it. `batch` is what tells the two apart, and
   * it does it better: swapping in an `InstancedMesh` would leave `batch` null.
   */
  type: string;
  geometry: string;
  material: string;
  castShadow: boolean;
  receiveShadow: boolean;
  visible: boolean;
  /** Set only on a `BatchedMesh`; the three flags are the culling it gave up. */
  batch: {
    members: number;
    perObjectFrustumCulled: boolean;
    sortObjects: boolean;
    frustumCulled: boolean;
  } | null;
}

/**
 * Everything about a projected scene that holds without a GPU.
 *
 * @param scene The three.js `Scene` the mode built — `engine.scene`, or the
 *   projection's own. Only its environment and its extra children are read.
 * @param binder The binder that scene was bound with. Everything the document
 *   asked for is under `binder.root`, and nothing else is.
 */
export function digestProjection(scene: Scene, binder: SceneBinder): ProjectionDigest {
  const lights: LightDigest[] = [];
  const draws: DrawDigest[] = [];

  /*
   * `binder.root`, not `scene.children`. Two things follow from that and both
   * are the point: the editor's overlays are out of scope by construction
   * rather than by a filter someone has to keep up to date, and a preview light
   * parented under the binder by mistake shows up in `lights` with an empty
   * `entityId` — which is exactly the failure worth catching.
   */
  binder.root.traverse((object: Object3D) => {
    if (object instanceof Light) lights.push(digestLight(object));
    else if (object instanceof Mesh) draws.push(digestDraw(object));
  });

  return {
    overlays: scene.children.filter((child) => child !== binder.root).map((child) => child.name),
    environment: digestEnvironment(scene),
    lights: sorted(lights),
    draws: sorted(draws),
    pools: binder.poolSizes,
  };
}

/**
 * A total order over entries, by their own serialisation.
 *
 * Sorted at all because the order objects reach the graph in is not a
 * difference anybody can see: a full sync and an incremental one arrive at the
 * same scene by different routes, and comparing modes on that would fail for a
 * reason that is not a bug. By serialisation rather than by a chosen key
 * because there is no field, or pair of fields, that separates four identical
 * cubes — and a partial key would leave their order to `Array.sort`'s.
 */
function sorted<T>(entries: T[]): T[] {
  return entries.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function digestLight(light: Light): LightDigest {
  // `shadow` exists on the kinds that can cast one and on no others — the same
  // property test `applyShadow` uses, and for the same reason: `castShadow` is
  // on every `Object3D`, so it cannot tell a spot from a rect area light.
  // `SpotLight` stands in for all four; every shadow read below is on the base
  // `LightShadow`.
  const shadow = (light as Light & Partial<SpotLight>).shadow ?? null;
  return {
    entityId: resolveEntityId(light) ?? '',
    type: light.type,
    color: `#${light.color.getHexString()}`,
    intensity: light.intensity,
    castShadow: light.castShadow,
    shadowMapSize: shadow ? [shadow.mapSize.x, shadow.mapSize.y] : [0, 0],
    shadowBias: shadow?.bias ?? 0,
    shadowNormalBias: shadow?.normalBias ?? 0,
  };
}

function digestDraw(mesh: Mesh): DrawDigest {
  return {
    entityId: resolveEntityId(mesh) ?? '',
    type: mesh.type,
    geometry: describeGeometry(mesh.geometry),
    material: describeMaterial(mesh.material),
    castShadow: mesh.castShadow,
    receiveShadow: mesh.receiveShadow,
    visible: mesh.visible,
    batch:
      mesh instanceof BatchedMesh
        ? {
            members: mesh.instanceCount,
            perObjectFrustumCulled: mesh.perObjectFrustumCulled,
            sortObjects: mesh.sortObjects,
            frustumCulled: mesh.frustumCulled,
          }
        : null,
  };
}

function digestEnvironment(scene: Scene): EnvironmentDigest {
  return {
    background: describeValue(scene.background),
    backgroundIntensity: scene.backgroundIntensity,
    // The `y` alone: the binder writes one angle into `(0, y, 0)` and never
    // touches the other two — see `syncEnvironment`.
    backgroundRotationY: scene.backgroundRotation.y,
    environment: describeValue(scene.environment),
    environmentIntensity: scene.environmentIntensity,
    fog: digestFog(scene),
  };
}

function digestFog(scene: Scene): FogDigest | null {
  const { fog } = scene;
  if (!fog) return null;
  if (fog instanceof FogExp2) {
    return { mode: 'exponential', color: `#${fog.color.getHexString()}`, density: fog.density };
  }
  // The only other thing `fogFor` builds, and three has no third kind.
  const linear = fog as { color: Color; near: number; far: number };
  return {
    mode: 'linear',
    color: `#${linear.color.getHexString()}`,
    near: linear.near,
    far: linear.far,
  };
}

/**
 * A geometry by what it holds rather than by which one it is.
 *
 * Vertex and index counts rather than the buffers themselves: two modes that
 * built the same primitive from the same parameters produce the same counts,
 * and a mode that built a different one — or pooled a geometry it should not
 * have shared — produces different ones.
 */
function describeGeometry(geometry: BufferGeometry): string {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  return `${geometry.type}(${position?.count ?? 0}v, ${index?.count ?? 0}i)`;
}

/**
 * Every property of a material that the document decides.
 *
 * Named one by one rather than walked, because a node material carries a tree
 * of node objects whose identity is fresh per instance: anything that reads
 * every own property — `toJSON` included — reports a difference on every build.
 * This is the list `buildMaterial` and `patchMaterial` write, which is the whole
 * of what a `MaterialDef` can reach.
 */
const MATERIAL_FIELDS = [
  'color',
  'roughness',
  'metalness',
  'emissive',
  'emissiveIntensity',
  'opacity',
  'transparent',
  'wireframe',
  'side',
  'map',
  'normalMap',
  'normalScale',
  'bumpMap',
  'bumpScale',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'aoMap',
  'aoMapIntensity',
  'alphaMap',
  'displacementMap',
  'displacementScale',
  'displacementBias',
] as const;

function describeMaterial(material: Material | Material[]): string {
  if (Array.isArray(material)) return material.map(describeMaterial).join(' + ');

  const values = material as unknown as Record<string, unknown>;
  const written = MATERIAL_FIELDS.flatMap((field) => {
    const described = describeValue(values[field]);
    // Absent rather than null: a material of another class — the water surface,
    // a helper — simply has fewer of these, and listing them as `null` would
    // claim it had been asked for one and answered no.
    return described === null && !(field in values) ? [] : [`${field}=${described}`];
  });
  return `${material.type}{ ${written.join(', ')} }`;
}

/**
 * One property, as a string that carries no identity.
 *
 * A texture is reported as the word `texture` and nothing more. Which image it
 * holds is a question about a file that has been loaded, which under Node it
 * has not; what matters here is that the two modes filled the same slots.
 */
function describeValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Color) return `#${value.getHexString()}`;
  if (value instanceof Texture) return 'texture';
  if (value instanceof Vector2) return `(${value.x}, ${value.y})`;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return String(value);
  }
  // Unreachable for the fields above as three types them today. Named rather
  // than swallowed, so a field that changes shape shows up as a difference
  // instead of comparing equal to every other object.
  return `<unreadable ${typeof value}>`;
}
