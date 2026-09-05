import { createCameraEntity } from '../components/camera/defaults';
import { createLightEntity } from '../components/light/defaults';
import { createMeshComponent } from '../components/mesh/defaults';
import { SCENE_FORMAT_VERSION } from '../constants';
import { createId } from '../ids';
import { emptyComponentTables, setComponentsOf } from './components';
import { createEntity, type EntityTemplate } from './entity';
import { createBoxGeometry } from './geometry';

/*
 * What is left once every component type owns its own factories: the sky and
 * the environment, which belong to a scene rather than to anything in it, and
 * the three ways to make a whole scene.
 *
 * No rule here is about a particular type any more. `createStarterScene` still
 * names three of them, and has to: a starter scene *is* a ground, a sun, a sky
 * and a camera, and a version of it that named no type would be an empty one.
 * What went was the last thing that named a type in order to *decide*
 * something — `isPlaceable`, which asked whether a light was ambient. The
 * types answer that themselves now; see `ComponentDefinition.placeable`.
 *
 * The slice imports point at each `<type>/defaults.ts` and never at its
 * `index.ts`: importing an index registers the type, and registration order is
 * the order the Add Component menu is built in.
 */
import type {
  CameraComponent,
  EnvironmentDef,
  MeshComponent,
  SceneDoc,
  SkySettings,
} from './schema';

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

