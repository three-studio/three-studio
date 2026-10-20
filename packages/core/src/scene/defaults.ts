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
 * the two ways to make a whole scene.
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

/**
 * A scene as the editor creates one: nothing in it but its environment.
 *
 * New scenes used to start with an empty entity called `Scene` at the root,
 * where scripts that belong to the level rather than to a thing in it were
 * meant to go. It read as the scene itself, and it was an ordinary entity that
 * nothing protected, so deleting it changed nothing at all. The Hierarchy now
 * names the scene in a line of its own, which is not an entity. A level script
 * goes on an Empty, the way Unity puts one on a GameManager: still an entity,
 * so `this.entity` and `this.transform` are never null for it, which is what
 * letting the scene itself carry scripts would cost.
 *
 * Scenes that have one keep it, untouched. It is the author's entity: it may
 * carry scripts, a script property may name it by id, and nothing could find
 * it but its name.
 *
 * It has to stay empty: the prefab migration borrows it, and a stray entity
 * here would appear inside every prefab.
 */
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

/** Scene a brand new project opens with: a ground plane, a light and a camera. */
export function createStarterScene(): SceneDoc {
  const scene = createEmptyScene();

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

