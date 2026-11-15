import { createCameraEntity } from '../components/camera/defaults';
import { createLightEntity } from '../components/light/defaults';
import { createMeshComponent } from '../components/mesh/defaults';
import { SCENE_FORMAT_VERSION } from '../constants';
import { createSceneId } from '../ids';
import { setComponentsOf } from './components';
import { createEntity } from './entity';
import { createEnvironment } from './environment';
import { createGeometry } from './geometry';
import { createMaterial } from './material';

/*
 * What is left once every component type owns its own factories, and the
 * environment its schema: the two ways to make a whole scene.
 *
 * No rule here is about a particular type any more. `createStarterScene` still
 * names three of them, and has to: a starter scene *is* a ground, a sun, a sky
 * and a camera, and a version of it that named no type would be an empty one.
 * What went was the last thing that named a type in order to *decide*
 * something — `isPlaceable`, which asked whether a light was ambient. The
 * types answer that themselves now; see `ComponentDefinition.placeable`.
 *
 * The slice imports point at each `<type>/defaults.ts` and never at its
 * `index.ts`: an index is the type's definition, and the core's activation list
 * is the one place that imports it.
 */
import type { SceneDoc } from './schema';

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
 * It has to stay empty: Prefab Mode borrows it, and a stray entity here would
 * appear inside every prefab.
 */
export function createEmptyScene(name = 'Main'): SceneDoc {
  return {
    version: SCENE_FORMAT_VERSION,
    id: createSceneId(),
    name,
    entities: new Map(),
    components: new Map(),
    unknownComponents: new Map(),
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
  const ground = createEntity('Ground', [
    {
      ...createMeshComponent('box'),
      geometry: { ...createGeometry('box'), width: 40, height: 1, depth: 40 },
      material: createMaterial('#6f7378'),
      // The ground receives shadows but has nothing above it to cast onto.
      castShadow: false,
    },
  ]);
  ground.entity.transform.position = [0, -0.5, 0];

  const sun = createLightEntity('directional');
  const sky = createLightEntity('hemisphere');
  const camera = createCameraEntity();
  for (const component of camera.components) {
    if (component.type === 'camera') component.isMain = true;
  }

  for (const template of [ground, sun, sky, camera]) {
    scene.entities.set(template.entity.id, template.entity);
    setComponentsOf(scene, template.entity.id, template.components);
    scene.rootOrder.push(template.entity.id);
  }
  return scene;
}

