#!/usr/bin/env node
/**
 * Writes the reference project the performance baseline is taken on.
 *
 *   node docs/chantier/baseline/make-scene.mjs <target-dir>
 *
 * The scene is not committed. It is three thousand entities of generated
 * geometry — several megabytes of JSON that says nothing a reader could check —
 * and a file that large in the repository would be reviewed by nobody and go
 * stale the first time a component gains a field. What is committed is the
 * recipe, which is short enough to read and which builds itself out of `core`'s
 * own factories, so a scene made a year from now is a scene this build can open.
 *
 * Deterministic in everything the numbers depend on: the grid, the geometry, the
 * materials, the camera. Only the ids are random, and nothing measures those.
 *
 * Run it from the repository root, against a scratch directory — never against a
 * project you care about. It refuses to write into one that already exists.
 */
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ASSETS_DIR,
  ASSET_KIND_INFO,
  CACHE_DIR,
  ENGINE_VERSION,
  PROJECT_FILE_NAME,
  PROJECT_FORMAT_VERSION,
  SCENES_DIR,
  SCENE_FILE_SUFFIX,
  createBoxGeometry,
  createBuildProfiles,
  createCameraEntity,
  createEntity,
  createLightEntity,
  createMeshComponent,
  createNewScene,
  createPhysicsSettings,
  createRenderingSettings,
  createWaterEntity,
  serializeScene,
  setComponentsOf,
} from '@three-studio/core';

/** Props laid out on the field. `COLS` divides it; the rest follows. */
const PROPS = 3000;
const COLS = 60;
const SPACING = 3.5;

/** Half the field, in metres — what the ground, the sun and the camera are sized against. */
const HALF_X = (COLS * SPACING) / 2;
const HALF_Z = ((PROPS / COLS) * SPACING) / 2;

/**
 * The six shapes the props cycle through, and how finely each is tessellated.
 *
 * Chosen for the triangle count, not for the look: a field of cubes is twelve
 * triangles apiece and measures the draw path alone. Half of these are heavy
 * enough that the vertex and shadow passes cost something, which is the only way
 * a change to either shows up as a different number.
 */
const SHAPES = [
  { kind: 'sphere', radius: 0.6, widthSegments: 64, heightSegments: 32 },
  { kind: 'torusKnot', radius: 0.5, tube: 0.15, tubularSegments: 96, radialSegments: 16, p: 2, q: 3 },
  { kind: 'torus', radius: 0.5, tube: 0.18, radialSegments: 24, tubularSegments: 64 },
  { kind: 'capsule', radius: 0.4, height: 1, capSegments: 12, radialSegments: 24 },
  { kind: 'cylinder', radiusTop: 0.45, radiusBottom: 0.45, height: 1.4, radialSegments: 48 },
  { kind: 'box', width: 1, height: 1.6, depth: 1, widthSegments: 1, heightSegments: 1, depthSegments: 1 },
];

/**
 * Six materials, so the pools hold more than one of everything.
 *
 * A field where every prop shares one material and one shape pools down to a
 * single entry and a single batch, and "the pools hold 2" is not a measurement
 * of anything. Six shapes against six colours, stepped so that every shape meets
 * every colour, gives 36 distinct pairs — 36 batches, 6 geometries, 6 materials.
 */
const COLORS = ['#b64f3c', '#3c7fb6', '#5aa84f', '#c9a227', '#8a5ab6', '#c8ccd0'];

const target = process.argv[2];
if (!target) {
  console.error('usage: node docs/chantier/baseline/make-scene.mjs <target-dir>');
  process.exit(1);
}

const scene = createNewScene('Baseline');

/** Puts a template in the document. The root `Scene` entity is already there. */
function place(template) {
  scene.entities[template.entity.id] = template.entity;
  setComponentsOf(scene, template.entity.id, template.components);
  scene.rootOrder.push(template.entity.id);
  return template;
}

// The ground, a slab wide enough that the field never runs off its edge.
const ground = place(createEntity('Ground', [createMeshComponent('box')]));
ground.entity.transform.position = [0, -0.5, 0];
Object.assign(ground.components[0].geometry, {
  ...createBoxGeometry(),
  width: HALF_X * 2 + 20,
  height: 1,
  depth: HALF_Z * 2 + 20,
});
ground.components[0].material.color = '#55595e';
ground.components[0].castShadow = false;

// The shadowed sun. `orthoSize` is the one setting that has to be told how big
// the scene is: three's default of 5 covers ten metres, so at this scale the
// shadow pass would draw the whole field into a map that shows a tenth of it —
// a cost with nothing on screen to show for it, which is the worst kind of
// baseline.
const sun = place(createLightEntity('directional'));
sun.entity.transform.position = [HALF_X, 90, HALF_Z];
sun.components[0].shadow.orthoSize = Math.max(HALF_X, HALF_Z) + 10;
sun.components[0].shadow.far = 400;

// Water, a sheet across the middle of the field. It reflects, which is a second
// render of everything above it from a mirrored camera — the single most
// expensive thing in the scene, and the reason it is here.
const water = place(createWaterEntity());
water.entity.transform.position = [0, 0.35, 0];
Object.assign(water.components[0].geometry, { width: 90, height: 90 });

// The camera Play starts on. Pitched down onto the origin from the near edge of
// the field, so the shot is the same in the viewport and in the game — see the
// pose `measure.js` gives the editor camera.
const camera = place(createCameraEntity());
camera.components[0].isMain = true;
camera.entity.transform.position = [0, 30, HALF_Z + 40];
camera.entity.transform.rotation = [-Math.atan2(30, HALF_Z + 40), 0, 0];

// The field. Row-major, centred on the origin, shape and colour stepping at
// different rates so the two never line up.
for (let i = 0; i < PROPS; i++) {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const shape = SHAPES[i % SHAPES.length];
  const mesh = createMeshComponent(shape.kind);
  mesh.geometry = { ...shape };
  mesh.material.color = COLORS[(row + col) % COLORS.length];

  const prop = place(createEntity(`Prop ${i}`, [mesh]));
  prop.entity.transform.position = [
    col * SPACING - HALF_X + SPACING / 2,
    1.2,
    row * SPACING - HALF_Z + SPACING / 2,
  ];
}

// The sky, seen and lighting: `background` sends the image-based lighting back
// to whatever the background already is, so the analytic sky is the only light
// source besides the sun and there is no texture to load.
scene.environment.backgroundMode = 'sky';
scene.environment.environmentMode = 'background';
scene.environment.sky.elevation = 24;
scene.environment.sky.azimuth = 135;

const scenePath = `${SCENES_DIR}/baseline${SCENE_FILE_SUFFIX}`;

// Refuses an existing directory rather than merging into it: the obvious
// mistake here is pointing this at a real project, and a merge would leave one
// scene of three thousand cylinders behind with no way to tell it apart.
if (await access(target).then(() => true, () => false)) {
  console.error(`${target} already exists — point this at a new directory.`);
  process.exit(1);
}

await mkdir(join(target, SCENES_DIR), { recursive: true });
await mkdir(join(target, CACHE_DIR), { recursive: true });
for (const directory of new Set(Object.values(ASSET_KIND_INFO).map((it) => it.directory))) {
  await mkdir(join(target, ASSETS_DIR, directory), { recursive: true });
}

const project = {
  version: PROJECT_FORMAT_VERSION,
  name: 'Baseline',
  engineVersion: ENGINE_VERSION,
  startScene: scene.id,
  settings: {
    loadingScene: null,
    rendering: createRenderingSettings(),
    physics: createPhysicsSettings(),
    build: createBuildProfiles('Baseline'),
  },
};

await writeFile(join(target, PROJECT_FILE_NAME), JSON.stringify(project, null, 2), 'utf8');
await writeFile(join(target, scenePath), serializeScene(scene), 'utf8');
await writeFile(join(target, '.gitignore'), `${CACHE_DIR}/\n`, 'utf8');
await writeFile(join(target, CACHE_DIR, '.gitignore'), '*\n', 'utf8');

console.log(`${target}: ${Object.keys(scene.entities).length} entities, scene id ${scene.id}`);
