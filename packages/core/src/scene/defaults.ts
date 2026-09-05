import { createCameraEntity } from '../components/camera/defaults';
import { createLightEntity } from '../components/light/defaults';
import { SCENE_FORMAT_VERSION } from '../constants';
import { createId } from '../ids';
import { emptyComponentTables, setComponentsOf } from './components';
import { createEntity, type EntityTemplate } from './entity';
import type {
  CameraComponent,
  ComponentDoc,
  ComponentOfType,
  ComponentType,
  EnvironmentDef,
  GeometryDef,
  GeometryKind,
  LightKind,
  MaterialDef,
  MeshComponent,
  SceneDoc,
  SkySettings,
  WaterComponent,
} from './schema';
import { SUN_FROM_SKY } from './water';

export function createMaterial(color = '#b7b7b7'): MaterialDef {
  return {
    color,
    roughness: 0.75,
    metalness: 0,
    emissive: '#000000',
    emissiveIntensity: 1,
    opacity: 1,
    transparent: false,
    wireframe: false,
    side: 'front',
    colorMap: null,
    normalMap: null,
    normalScale: 1,
    bumpMap: null,
    bumpScale: 1,
    roughnessMap: null,
    metalnessMap: null,
    emissiveMap: null,
    aoMap: null,
    aoIntensity: 1,
    alphaMap: null,
    displacementMap: null,
    displacementScale: 0.1,
    displacementBias: 0,
    tiling: [1, 1],
    offset: [0, 0],
    wrap: 'repeat',
  };
}

/** Narrowed helper: `createGeometry` returns the union, which cannot be spread. */
export function createBoxGeometry(): Extract<GeometryDef, { kind: 'box' }> {
  return createGeometry('box') as Extract<GeometryDef, { kind: 'box' }>;
}

export function createGeometry(kind: GeometryKind): GeometryDef {
  switch (kind) {
    case 'box':
      return {
        kind,
        width: 1,
        height: 1,
        depth: 1,
        widthSegments: 1,
        heightSegments: 1,
        depthSegments: 1,
      };
    case 'sphere':
      return { kind, radius: 0.5, widthSegments: 32, heightSegments: 16 };
    case 'plane':
      return { kind, width: 10, height: 10, widthSegments: 1, heightSegments: 1 };
    case 'capsule':
      return { kind, radius: 0.5, height: 1, capSegments: 8, radialSegments: 16 };
    case 'cylinder':
      return { kind, radiusTop: 0.5, radiusBottom: 0.5, height: 1, radialSegments: 24 };
    case 'circle':
      return { kind, radius: 0.5, segments: 32 };
    case 'ring':
      return { kind, innerRadius: 0.25, outerRadius: 0.5, thetaSegments: 32 };
    case 'torus':
      return { kind, radius: 0.4, tube: 0.15, radialSegments: 16, tubularSegments: 48 };
    case 'torusKnot':
      return { kind, radius: 0.4, tube: 0.12, tubularSegments: 96, radialSegments: 16, p: 2, q: 3 };
    case 'tetrahedron':
    case 'octahedron':
    case 'dodecahedron':
    case 'icosahedron':
      return { kind, radius: 0.5, detail: 0 };
  }
}

/**
 * A water surface, at `WaterMesh`'s own defaults where it has one.
 *
 * The plane is 50 m and undivided: the ripples are a normal map, not moved
 * vertices, so segments buy nothing here and a subdivided sheet would only cost
 * the reflection pass more to draw.
 *
 * `sunSource` starts on the sky rather than on `WaterMesh`'s `(0.707, 0.707, 0)`
 * because every scene this project makes has a sky, and a water whose glint
 * disagrees with the sun above it is the first thing an author has to fix.
 */
export function createWater(): WaterComponent {
  return {
    id: createId(),
    type: 'water',
    geometry: { kind: 'plane', width: 50, height: 50, widthSegments: 1, heightSegments: 1 },
    normalMapId: null,
    waterColor: '#7f7f7f',
    sunSource: SUN_FROM_SKY,
    sunDirection: [0.70707, 0.70707, 0],
    sunColor: '#ffffff',
    alpha: 1,
    size: 1,
    // The three below are `WaterMesh`'s own behaviour written down, so a surface
    // added today and one added before they existed look identical.
    speed: 1,
    direction: 0,
    choppiness: 1.5,
    distortionScale: 20,
    resolutionScale: 0.5,
    side: 'front',
    fog: false,
  };
}

export function createMeshComponent(kind: GeometryKind): MeshComponent {
  return {
    id: createId(),
    type: 'mesh',
    geometry: createGeometry(kind),
    material: createMaterial(),
    materialId: null,
    castShadow: true,
    receiveShadow: true,
  };
}

export const GEOMETRY_LABELS: Record<GeometryKind, string> = {
  box: 'Cube',
  sphere: 'Sphere',
  plane: 'Plane',
  capsule: 'Capsule',
  cylinder: 'Cylinder',
  circle: 'Circle',
  ring: 'Ring',
  torus: 'Torus',
  torusKnot: 'Torus Knot',
  tetrahedron: 'Tetrahedron',
  octahedron: 'Octahedron',
  dodecahedron: 'Dodecahedron',
  icosahedron: 'Icosahedron',
};

/** three builds these in the XY plane, so they face the camera rather than up. */
const FLAT_KINDS: ReadonlySet<GeometryKind> = new Set(['plane', 'circle', 'ring']);

/**
 * How far above its support point a fresh primitive's origin has to sit for the
 * shape to rest on that point rather than sink through it.
 *
 * Read in the entity's own frame, so the flat kinds answer zero: the rotation
 * `createMeshEntity` gives them has already laid them down, and a sheet on the
 * ground *is* the ground.
 *
 * Was a hard-coded `0.5`, which is the right answer for a unit cube and a
 * half-metre sphere and wrong for everything else — a torus floated by the
 * difference between its tube and that constant.
 */
export function restingOffsetY(geometry: GeometryDef): number {
  switch (geometry.kind) {
    case 'box':
    case 'cylinder':
      return geometry.height / 2;
    case 'sphere':
    case 'tetrahedron':
    case 'octahedron':
    case 'dodecahedron':
    case 'icosahedron':
      return geometry.radius;
    case 'capsule':
      // three's capsule height is the cylinder alone; the caps are extra.
      return geometry.height / 2 + geometry.radius;
    case 'plane':
    case 'circle':
    case 'ring':
      return 0;
    case 'torus':
      return geometry.tube;
    case 'torusKnot':
      // Exact, not a guess: three's `calculatePositionOnCurve` puts the curve at
      // `radius * (2 + cos θ) * 0.5` from the origin, so at most `radius * 1.5`.
      return geometry.radius * 1.5 + geometry.tube;
  }
}

export function createMeshEntity(kind: GeometryKind): EntityTemplate {
  const mesh = createMeshComponent(kind);
  const template = createEntity(GEOMETRY_LABELS[kind], [mesh]);
  if (FLAT_KINDS.has(kind)) {
    // Authors expect a flat primitive to be ground, not a wall.
    template.entity.transform.rotation = [-Math.PI / 2, 0, 0];
  }
  // Rest primitives on their support instead of half-sunk into it. Read as an
  // offset from wherever the object is being placed, not as a position — see
  // `placementTransform` in the editor.
  template.entity.transform.position = [0, restingOffsetY(mesh.geometry), 0];
  return template;
}

/**
 * A water surface, laid flat where the author is looking.
 *
 * Flat for the same reason `createMeshEntity` lays a plane down — three builds
 * its plane in the XY plane, facing the camera — and at zero height, because a
 * sheet on the ground is the ground.
 */
export function createWaterEntity(): EntityTemplate {
  const template = createEntity('Water', [createWater()]);
  template.entity.transform.rotation = [-Math.PI / 2, 0, 0];
  return template;
}

/** Light kinds three applies to the whole scene, wherever the object stands. */
const UNPLACED_LIGHTS: ReadonlySet<LightKind> = new Set(['ambient', 'hemisphere']);

/**
 * Whether a template's transform describes a place in the world.
 *
 * Only ambient and hemisphere lights say no, and they say it because their
 * position has no effect at all: moving one where the author is looking would
 * put a number in the inspector that means nothing, which reads as a bug the
 * first time someone drags it and nothing happens.
 */
export function isPlaceable(template: EntityTemplate): boolean {
  const { components } = template;
  // An empty carries no components and is still a place: it exists to hold
  // whatever gets dragged under it, so it belongs where the author is looking.
  if (components.length === 0) return true;
  return !components.every(
    (component) => component.type === 'light' && UNPLACED_LIGHTS.has(component.kind),
  );
}

/** three's own `SkyMesh` defaults, which are a clear early morning. */
export function createSkySettings(): SkySettings {
  return {
    elevation: 2,
    azimuth: 180,
    turbidity: 2,
    rayleigh: 1,
    mieCoefficient: 0.005,
    mieDirectionalG: 0.8,
    sunDisc: true,
    cloudCoverage: 0.4,
    cloudDensity: 0.4,
    cloudScale: 0.0002,
    cloudElevation: 0.5,
    cloudSpeed: 0.0001,
  };
}

/**
 * The environment a scene starts with, and what every migration fills against.
 *
 * A factory rather than a literal inside `createEmptyScene`, so that rule 2 of
 * the persisted-format rules holds by construction: `fillMissingFields` merges
 * `{ ...createEnvironment(), ...stored }`, and a property added here is
 * migrated by existing. Every default is chosen so that filling it into a scene
 * written before it existed changes nothing on screen — which is the only way
 * to add a field to a persisted format without auditing every project.
 */
export function createEnvironment(): EnvironmentDef {
  return {
    backgroundMode: 'color',
    background: '#2b2f33',
    backgroundTexture: null,
    // three's own: no blur, no attenuation.
    backgroundBlur: 0,
    backgroundIntensity: 1,
    // `texture` rather than `background`, because it is what a scene written
    // before this field did: the lighting came from `environmentTexture` and
    // from nothing else, whether or not that slot was filled.
    environmentMode: 'texture',
    environmentTexture: null,
    environmentIntensity: 1,
    rotation: 0,
    sky: createSkySettings(),
    fogEnabled: false,
    fogColor: '#2b2f33',
    fogMode: 'linear',
    fogNear: 30,
    fogFar: 400,
    // three's own default is 0.00025, which is invisible at the scale a
    // blockout is built at. Unity's 0.01 puts the horizon around 200 units.
    fogDensity: 0.01,
  };
}

export function createEmptyScene(name = 'Main'): SceneDoc {
  return {
    version: SCENE_FORMAT_VERSION,
    id: createId(),
    name,
    entities: {},
    components: emptyComponentTables(),
    rootOrder: [],
    environment: createEnvironment(),
  };
}

/**
 * A scene as the editor creates one: empty, plus the root `Scene` entity.
 *
 * That entity is where scripts that belong to the level rather than to a thing
 * in it are attached — Unity puts them on a GameObject and Godot on the root
 * node, and both do it because the alternative, letting the scene itself carry
 * scripts, makes `this.entity` and `this.transform` null for those alone. It is
 * an ordinary entity: a convention, not a feature, and nothing protects it.
 *
 * Separate from `createEmptyScene`, which must stay genuinely empty — the
 * prefab migration borrows it, and a stray entity there would appear inside
 * every prefab.
 */
export function createNewScene(name = 'Main'): SceneDoc {
  const scene = createEmptyScene(name);
  const root = createEntity('Scene');
  scene.entities[root.entity.id] = root.entity;
  scene.rootOrder.push(root.entity.id);
  return scene;
}

/** Scene a brand new project opens with: a ground plane, a light and a camera. */
export function createStarterScene(): SceneDoc {
  const scene = createNewScene();

  // A slab rather than a rotated plane. A plane would look the same, but its
  // entity carries a -90° rotation, and a rotated static body makes the
  // character controller lose part of a sideways move — measurably, and only
  // sideways. An unrotated box has none of that, and matches what other engines
  // ship as a default floor.
  const ground = createEntity('Ground', [createMeshComponent('box')]);
  ground.entity.transform.position = [0, -0.5, 0];
  const groundMesh = ground.components[0] as MeshComponent;
  groundMesh.geometry = { ...createBoxGeometry(), width: 40, height: 1, depth: 40 };
  groundMesh.material.color = '#6f7378';
  // The ground receives shadows but has nothing above it to cast onto.
  groundMesh.castShadow = false;

  const sun = createLightEntity('directional');
  const sky = createLightEntity('hemisphere');
  const camera = createCameraEntity();
  (camera.components[0] as CameraComponent).isMain = true;

  for (const template of [ground, sun, sky, camera]) {
    scene.entities[template.entity.id] = template.entity;
    setComponentsOf(scene, template.entity.id, template.components);
    scene.rootOrder.push(template.entity.id);
  }
  return scene;
}

