import { mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  ASSETS_DIR,
  ASSET_KIND_INFO,
  CACHE_DIR,
  createBoxGeometry,
  createCameraEntity,
  createComponent,
  createEmptyScene,
  createEntity,
  createLightEntity,
  createMeshComponent,
  createModelEntity,
  createWaterEntity,
  insertEntity,
  serializeScene,
  type AssetId,
  type AssetManifest,
  type ComponentDoc,
  type ComponentOfType,
  type EntityTemplate,
  type GeometryDef,
  type SceneDoc,
  type SceneId,
} from '@three-studio/core';
import { scanAssets, updateAssetSettings } from '../../../apps/desktop/src/main/assetScan';
import { writeGlb } from '../../../apps/desktop/src/main/glb';
import { createProject, saveScene } from '../../../apps/desktop/src/main/project';
import { createScene, deleteScene, setStartScene } from '../../../apps/desktop/src/main/scenes';
import { GEOMETRY, TEXTURES, geometryGlb, texturesGlb, type GeometryRecipe, type TexturesRecipe } from './glb';
import { encodePng } from './png';

/*
 * The scratch projects the harness measures, one function per recipe.
 *
 * Each builds its documents and buffers in memory, and the app's own code puts
 * them on disk: `createProject` lays the project out, `scanAssets` writes the
 * sidecars and hands out the asset ids, `createScene` and `saveScene` write the
 * scenes. A project made a year from now is then one that build can open, and
 * a format change breaks the generators' test before it breaks a run.
 *
 * Deterministic in everything measured. Only the ids are random.
 */

/** The template's one component of a type. The factories hand back the union. */
function componentOf<T extends ComponentDoc['type']>(template: EntityTemplate, type: T): ComponentOfType<T> {
  for (const component of template.components) {
    if (isOfType(component, type)) return component;
  }
  throw new Error(`${template.entity.name} has no ${type} component`);
}

function isOfType<T extends ComponentDoc['type']>(
  component: ComponentDoc,
  type: T,
): component is ComponentOfType<T> {
  return component.type === type;
}

/** `items[index]`, wrapping round. */
function cycle<T>(items: readonly T[], index: number): T {
  const item = items[index % items.length];
  if (item === undefined) throw new Error('cycle() over an empty list');
  return item;
}

function place(scene: SceneDoc, template: EntityTemplate, parentId: string | null = null): EntityTemplate {
  if (!insertEntity(scene, template, parentId)) throw new Error(`could not insert ${template.entity.name}`);
  return template;
}

// ---------------------------------------------------------------- the field

export interface RenderRecipe {
  readonly props: number;
  /** Props per row. Divides `props`. */
  readonly columns: number;
}

/**
 * September's render scene, again: 3 000 props on a 60 × 50 grid, a ground, a
 * shadowed sun, water, a main camera, and the analytic sky seen and lighting.
 * 3 004 entities: September's 3 005 counted the root `Scene` entity a new scene
 * no longer has.
 */
export const RENDER: RenderRecipe = { props: 3000, columns: 60 };

const PROP_SPACING = 3.5;

/**
 * The six shapes the props cycle through, chosen for their triangle counts: a
 * field of cubes measures the draw path alone, and half of these are heavy
 * enough that the vertex and shadow passes cost something.
 */
const PROP_SHAPES: readonly GeometryDef[] = [
  { kind: 'sphere', radius: 0.6, widthSegments: 64, heightSegments: 32 },
  { kind: 'torusKnot', radius: 0.5, tube: 0.15, tubularSegments: 96, radialSegments: 16, p: 2, q: 3 },
  { kind: 'torus', radius: 0.5, tube: 0.18, radialSegments: 24, tubularSegments: 64 },
  { kind: 'capsule', radius: 0.4, height: 1, capSegments: 12, radialSegments: 24 },
  { kind: 'cylinder', radiusTop: 0.45, radiusBottom: 0.45, height: 1.4, radialSegments: 48 },
  { kind: 'box', width: 1, height: 1.6, depth: 1, widthSegments: 1, heightSegments: 1, depthSegments: 1 },
];

/**
 * Six colours against six shapes, stepped so every shape meets every colour:
 * 36 distinct pairs, so 36 batches. One material and one shape would batch down
 * to a single draw, and "the pools hold 1" measures nothing.
 */
const PROP_COLORS: readonly string[] = ['#b64f3c', '#3c7fb6', '#5aa84f', '#c9a227', '#8a5ab6', '#c8ccd0'];

/** Half the field, in metres: what the ground, the sun and the camera are sized against. */
function halfField(recipe: RenderRecipe): { x: number; z: number } {
  return { x: (recipe.columns * PROP_SPACING) / 2, z: ((recipe.props / recipe.columns) * PROP_SPACING) / 2 };
}

/** Row-major, centred on the origin, shape and colour stepping at different rates. */
function placeProps(scene: SceneDoc, recipe: RenderRecipe): void {
  const half = halfField(recipe);
  for (let i = 0; i < recipe.props; i += 1) {
    const column = i % recipe.columns;
    const row = Math.floor(i / recipe.columns);
    const shape = cycle(PROP_SHAPES, i);
    const mesh = createMeshComponent(shape.kind);
    mesh.geometry = { ...shape };
    mesh.material.color = cycle(PROP_COLORS, row + column);
    const prop = place(scene, createEntity(`Prop ${i}`, [mesh]));
    prop.entity.transform.position = [
      column * PROP_SPACING - half.x + PROP_SPACING / 2,
      1.2,
      row * PROP_SPACING - half.z + PROP_SPACING / 2,
    ];
  }
}

/**
 * A shadowed sun over a field of this half-size. `orthoSize` is the one setting
 * that must be told how big the scene is: three's default covers ten metres, and
 * the shadow pass would draw the whole field into a map showing a tenth of it.
 */
function placeSun(scene: SceneDoc, half: { x: number; z: number }): void {
  const sun = place(scene, createLightEntity('directional'));
  sun.entity.transform.position = [half.x, 90, half.z];
  const light = componentOf(sun, 'light');
  light.shadow.orthoSize = Math.max(half.x, half.z) + 10;
  light.shadow.far = 400;
}

/** The camera Play starts on, pitched down onto the origin from the near edge. */
function placeCamera(scene: SceneDoc, half: { x: number; z: number }): void {
  const camera = place(scene, createCameraEntity());
  componentOf(camera, 'camera').isMain = true;
  camera.entity.transform.position = [0, 30, half.z + 40];
  camera.entity.transform.rotation = [-Math.atan2(30, half.z + 40), 0, 0];
}

function placeGround(scene: SceneDoc, half: { x: number; z: number }): void {
  const mesh = createMeshComponent('box');
  mesh.geometry = { ...createBoxGeometry(), width: half.x * 2 + 20, height: 1, depth: half.z * 2 + 20 };
  mesh.material.color = '#55595e';
  mesh.castShadow = false;
  const ground = place(scene, createEntity('Ground', [mesh]));
  ground.entity.transform.position = [0, -0.5, 0];
}

/** The `render` recipe's scene, in memory. */
export function renderScene(recipe: RenderRecipe = RENDER): SceneDoc {
  const scene = createEmptyScene();
  const half = halfField(recipe);
  placeGround(scene, half);
  placeSun(scene, half);

  // Water across the middle of the field. It reflects, which renders
  // everything above it a second time from a mirrored camera: the most
  // expensive thing in the scene, and the reason it is here.
  const water = place(scene, createWaterEntity());
  water.entity.transform.position = [0, 0.35, 0];
  const surface = componentOf(water, 'water');
  surface.geometry = { ...surface.geometry, width: 90, height: 90 };

  placeCamera(scene, half);
  placeProps(scene, recipe);

  // The sky, seen and lighting, so there is no texture to load.
  scene.environment.backgroundMode = 'sky';
  scene.environment.environmentMode = 'background';
  scene.environment.sky.elevation = 24;
  scene.environment.sky.azimuth = 135;
  return scene;
}

// ---------------------------------------------------------------- the crowd

export interface LargeRecipe {
  readonly groups: number;
  /** Groups per row. Divides `groups`. */
  readonly columns: number;
  readonly childrenPerGroup: number;
}

/** 1 000 groups of 9 low-poly children on a 40 × 25 grid, a ground, a sun, a camera: 10 003 entities. */
export const LARGE: LargeRecipe = { groups: 1000, columns: 40, childrenPerGroup: 9 };

/** Low-poly, so the scene's cost is its entity count and not its triangles. */
const LOW_POLY: readonly GeometryDef[] = [
  { kind: 'box', width: 0.8, height: 0.8, depth: 0.8, widthSegments: 1, heightSegments: 1, depthSegments: 1 },
  { kind: 'sphere', radius: 0.45, widthSegments: 8, heightSegments: 6 },
  { kind: 'cylinder', radiusTop: 0.35, radiusBottom: 0.35, height: 0.9, radialSegments: 8 },
];

const GROUP_SPACING = 4.5;
const CHILD_SPACING = 1.2;

/** The `large` recipe's scene, in memory. */
export function largeScene(recipe: LargeRecipe = LARGE): SceneDoc {
  const scene = createEmptyScene();
  const half = {
    x: (recipe.columns * GROUP_SPACING) / 2,
    z: ((recipe.groups / recipe.columns) * GROUP_SPACING) / 2,
  };
  placeGround(scene, half);
  placeSun(scene, half);
  placeCamera(scene, half);

  const side = Math.ceil(Math.sqrt(recipe.childrenPerGroup));
  for (let g = 0; g < recipe.groups; g += 1) {
    const group = place(scene, createEntity(`Group ${g}`));
    group.entity.transform.position = [
      (g % recipe.columns) * GROUP_SPACING - half.x + GROUP_SPACING / 2,
      0.5,
      Math.floor(g / recipe.columns) * GROUP_SPACING - half.z + GROUP_SPACING / 2,
    ];
    for (let k = 0; k < recipe.childrenPerGroup; k += 1) {
      const shape = cycle(LOW_POLY, k);
      const mesh = createMeshComponent(shape.kind);
      mesh.geometry = { ...shape };
      mesh.material.color = cycle(PROP_COLORS, g + k);
      const child = place(scene, createEntity(`Piece ${g}.${k}`, [mesh]), group.entity.id);
      child.entity.transform.position = [
        ((k % side) - (side - 1) / 2) * CHILD_SPACING,
        0,
        (Math.floor(k / side) - (side - 1) / 2) * CHILD_SPACING,
      ];
    }
  }
  return scene;
}

// ------------------------------------------------------------------ writers

/** A new project, its folder's path, and the scene it opens on. */
async function newProject(name: string, parent: string): Promise<{ path: string; scenePath: string; sceneId: SceneId }> {
  const opened = await createProject(name, parent);
  return { path: opened.summary.path, scenePath: opened.scenePath, sceneId: opened.sceneId };
}

/** Writes `scene` over the project's start scene, keeping that scene's id so `startScene` still names it. */
async function saveAsStartScene(project: { path: string; scenePath: string; sceneId: SceneId }, scene: SceneDoc): Promise<void> {
  scene.id = project.sceneId;
  await saveScene(project.path, project.scenePath, serializeScene(scene));
}

/** Writes the `render` recipe's project into `parent`, and answers its path. */
export async function writeRenderProject(parent: string, recipe: RenderRecipe = RENDER): Promise<string> {
  const project = await newProject('Render', parent);
  await saveAsStartScene(project, renderScene(recipe));
  return project.path;
}

/** Writes the `large` recipe's project into `parent`, and answers its path. */
export async function writeLargeProject(parent: string, recipe: LargeRecipe = LARGE): Promise<string> {
  const project = await newProject('Large', parent);
  await saveAsStartScene(project, largeScene(recipe));
  return project.path;
}

// ------------------------------------------------------------------- assets

export interface AssetsRecipe {
  readonly textures: number;
  readonly folders: number;
}

/** September's: 3 000 16 × 16 PNGs of distinct colours, in 30 folders. */
export const ASSETS: AssetsRecipe = { textures: 3000, folders: 30 };

/**
 * Every texture's modification time, fixed. The manifest carries each file's
 * `mtimeMs`, a decimal whose digits vary with the moment it was written, so
 * the manifest's bytes — a count, judged identical — moved by a few bytes
 * from one generation to the next.
 */
const ASSET_TIME_SECONDS = Date.UTC(2026, 0, 1) / 1000;

const ASSET_SIDE = 16;

/**
 * Every texture the recipe writes, by its path in the project.
 *
 * Folders rather than one flat directory, because a real project has them and
 * renaming one is the cheapest way to move a hundred assets at once. A colour
 * per file, so no two files hash alike: a scan of 3 000 copies of one hash is
 * not the scan a real project performs.
 */
export function assetTextures(recipe: AssetsRecipe = ASSETS): { path: string; color: number }[] {
  const digits = String(recipe.textures - 1).length;
  return Array.from({ length: recipe.textures }, (_, i) => ({
    path: [
      ASSETS_DIR,
      ASSET_KIND_INFO.texture.directory,
      `pack-${String(i % recipe.folders).padStart(2, '0')}`,
      `tex-${String(i).padStart(digits, '0')}.png`,
    ].join('/'),
    color: i,
  }));
}

/** Writes the `assets` recipe's project into `parent`, sidecars included, and answers its path. */
export async function writeAssetsProject(parent: string, recipe: AssetsRecipe = ASSETS): Promise<string> {
  const project = await newProject('Assets', parent);
  for (const texture of assetTextures(recipe)) {
    const file = join(project.path, texture.path);
    await mkdir(dirname(file), { recursive: true });
    const png = encodePng({
      width: ASSET_SIDE,
      height: ASSET_SIDE,
      fillRow: (_y, rgb) => {
        for (let x = 0; x < ASSET_SIDE; x += 1) {
          rgb[x * 3] = (texture.color >> 16) & 0xff;
          rgb[x * 3 + 1] = (texture.color >> 8) & 0xff;
          rgb[x * 3 + 2] = texture.color & 0xff;
        }
      },
    });
    await writeFile(file, png);
    await utimes(file, ASSET_TIME_SECONDS, ASSET_TIME_SECONDS);
  }
  await scanAssets(project.path);
  return project.path;
}

// ------------------------------------------------------------------- models

/** The model's entry in a manifest, found by its path. */
function assetAt(manifest: AssetManifest, path: string): AssetManifest['assets'][number] {
  const entry = manifest.assets.find((asset) => asset.path === path);
  if (!entry) throw new Error(`the scan did not list ${path}`);
  return entry;
}

/**
 * A scene holding one model, with a sun sized to a field of `half` and a main
 * camera: over the field, or at `cameraAt` looking down -z when given.
 */
async function saveModelScene(
  project: { path: string; scenePath: string; sceneId: SceneId },
  manifest: AssetManifest,
  modelPath: string,
  half: { x: number; z: number },
  cameraAt?: readonly [number, number, number],
): Promise<void> {
  const scene = createEmptyScene();
  placeSun(scene, half);
  if (cameraAt === undefined) placeCamera(scene, half);
  else {
    const camera = place(scene, createCameraEntity());
    componentOf(camera, 'camera').isMain = true;
    camera.entity.transform.position = [...cameraAt];
  }
  place(scene, createModelEntity(assetAt(manifest, modelPath).id, 'Model'));
  await saveAsStartScene(project, scene);
}

function modelPathIn(name: string): string {
  return [ASSETS_DIR, ASSET_KIND_INFO.model.directory, name].join('/');
}

/**
 * Writes the `geometry` recipe's project into `parent`, and answers its path.
 *
 * Loaded as written, and that takes a step of its own. The scan gives a new
 * model the importer's defaults, and above 2 MB those load it through a copy
 * whose geometry is quantised and meshopt-encoded, about a quarter of the
 * size. The brief asks for several hundred MB *loaded*: so right after the scan
 * that creates its sidecar, compression is turned off as the Inspector would,
 * the copy is removed, and the second scan writes the marker that says the
 * source needs nothing. The one compression this costs is paid per generation.
 */
export async function writeGeometryProject(parent: string, recipe: GeometryRecipe = GEOMETRY): Promise<string> {
  const project = await newProject('Geometry', parent);
  const modelPath = modelPathIn('geometry.glb');
  await writeFile(join(project.path, modelPath), writeGlb(geometryGlb(recipe)));

  const settings = assetAt(await scanAssets(project.path), modelPath).settings;
  if (settings.kind !== 'model') throw new Error(`${modelPath} was not scanned as a model`);
  await updateAssetSettings(project.path, modelPath, { ...settings, compressGeometry: false });
  await rm(join(project.path, CACHE_DIR, 'imported'), { recursive: true, force: true });

  // The grids span 50 × 2.2 m by 30 × 2.2 m.
  await saveModelScene(project, await scanAssets(project.path), modelPath, { x: 60, z: 40 });
  return project.path;
}

/**
 * Writes the `textures` recipe's project into `parent`, and answers its path.
 *
 * The default import, which is what a user gets. Its capped copy is not built
 * here: in Node the scan cannot scale an embedded image (that takes Electron's
 * `nativeImage`), so it says so once and leaves the copy to the editor's first
 * scan — the scenario's warm-up launch.
 */
export async function writeTexturesProject(parent: string, recipe: TexturesRecipe = TEXTURES): Promise<string> {
  const project = await newProject('Textures', parent);
  const modelPath = modelPathIn('textures.glb');
  await writeFile(join(project.path, modelPath), writeGlb(texturesGlb(recipe)));
  // The quads stand in a row 20 m long, facing +z: Play's camera stands back
  // just far enough to show the whole row, so the images are drawn large.
  await saveModelScene(project, await scanAssets(project.path), modelPath, { x: 12, z: 6 }, [0, 1, 18]);
  return project.path;
}

// ----------------------------------------------------------------- scripted

export interface ScriptedRecipe {
  /** Props in each of `A` and `B`. Multiple of 10. */
  readonly props: number;
  /** Ballast scripts, each on an entity of `A`. */
  readonly ballast: number;
  /** `Heavy`, the scene the loading screen is shown in front of. */
  readonly heavy: RenderRecipe;
  /**
   * A model of images `Heavy` holds besides its field, so that it has
   * something to load. With nothing to preload a scene is ready at once, and
   * the loading screen gets no frame: building its engine then blocks the
   * thread in one piece.
   */
  readonly heavyImages: TexturesRecipe;
}

/**
 * Four scenes and 52 scripts. `A` and `B` hold 100 props and a `Director`;
 * `Loading` a spinning cube; `Heavy` the render recipe's field and a model of
 * twelve 2 048² images. 50 ballast scripts of some 200 lines sit on entities
 * of `A`, so a bundle is worth retaining. The project sets no loading scene:
 * the scenario makes `Loading` one, after the switches it would otherwise
 * stand in front of.
 */
export const SCRIPTED: ScriptedRecipe = {
  props: 100,
  ballast: 50,
  heavy: RENDER,
  heavyImages: { primitives: 4, imageSide: 2048 },
};

/** What a ballast script's edit replaces: every edit → Play cycle bumps it. */
export const BALLAST_REVISION = 'const REVISION = 0;';

/*
 * The sources are lines joined rather than template literals: a line opening
 * with `import` or `export` reads as this file's own import to the
 * architecture test, which scans declarations by the line they open.
 */

const DIRECTOR = [
  `import { Behaviour } from '@three-studio/runtime';`,
  ``,
  `// The harness switches scenes from outside the game, through the API a script`,
  `// is handed: it reads it off the window once this scene has started.`,
  `export default class Director extends Behaviour {`,
  `  onStart(): void {`,
  `    Reflect.set(globalThis, '__perfScenes', this.scenes);`,
  `  }`,
  `}`,
  ``,
].join('\n');

const SPINNER = [
  `import { Behaviour } from '@three-studio/runtime';`,
  ``,
  `export default class Spinner extends Behaviour {`,
  `  onUpdate(delta: number): void {`,
  `    this.transform.rotation.y += 2 * delta;`,
  `  }`,
  `}`,
  ``,
].join('\n');

/** About 200 lines that do next to nothing, once, at start: code for a bundle to carry. */
function ballastSource(index: number): string {
  const steps = Array.from({ length: 48 }, (_, step) => step);
  const name = `Ballast${String(index).padStart(2, '0')}`;
  return [
    `import { Behaviour } from '@three-studio/runtime';`,
    ``,
    BALLAST_REVISION,
    ``,
    `export default class ${name} extends Behaviour {`,
    `  total = 0;`,
    ``,
    `  onStart(): void {`,
    `    this.total = REVISION + ${steps.map((step) => `this.step${step}(${index + step})`).join(' + ')};`,
    `  }`,
    ...steps.flatMap((step) => [
      ``,
      `  step${step}(x: number): number {`,
      `    const a = Math.sin(x * ${(1 + step / 100).toFixed(2)} + ${index});`,
      `    return a * a + Math.cos(x * ${(0.5 + step / 200).toFixed(3)});`,
      `  }`,
    ]),
    `}`,
    ``,
  ].join('\n');
}

/** The ballast scripts' paths in the project, in order. */
export function ballastPaths(recipe: ScriptedRecipe = SCRIPTED): string[] {
  return Array.from({ length: recipe.ballast }, (_, index) =>
    [ASSETS_DIR, ASSET_KIND_INFO.script.directory, `Ballast${String(index).padStart(2, '0')}.ts`].join('/'),
  );
}

function scriptOn(assetId: AssetId): ComponentDoc {
  return { ...createComponent('script'), assetId };
}

/** Writes the `scripted` recipe's project into `parent`, and answers its path. */
export async function writeScriptedProject(parent: string, recipe: ScriptedRecipe = SCRIPTED): Promise<string> {
  const project = await newProject('Scripted', parent);
  const scriptsDir = [ASSETS_DIR, ASSET_KIND_INFO.script.directory].join('/');
  const sources = new Map<string, string>([
    [`${scriptsDir}/Director.ts`, DIRECTOR],
    [`${scriptsDir}/Spinner.ts`, SPINNER],
    ...ballastPaths(recipe).map((path, index): [string, string] => [path, ballastSource(index)]),
  ]);
  for (const [path, source] of sources) await writeFile(join(project.path, path), source, 'utf8');
  const heavyModel = modelPathIn('heavy.glb');
  await writeFile(join(project.path, heavyModel), writeGlb(texturesGlb(recipe.heavyImages)));
  const manifest = await scanAssets(project.path);
  const script = (path: string): AssetId => assetAt(manifest, path).id;

  const field: RenderRecipe = { props: recipe.props, columns: 10 };
  const half = halfField(field);
  const directed = (): SceneDoc => {
    const scene = createEmptyScene();
    placeSun(scene, half);
    placeCamera(scene, half);
    placeProps(scene, field);
    place(scene, createEntity('Director', [scriptOn(script(`${scriptsDir}/Director.ts`))]));
    return scene;
  };

  const a = directed();
  for (const [index, path] of ballastPaths(recipe).entries()) {
    place(a, createEntity(`Ballast ${index}`, [scriptOn(script(path))]));
  }

  const loading = createEmptyScene();
  placeSun(loading, half);
  placeCamera(loading, half);
  const cube = createMeshComponent('box');
  cube.geometry = { ...createBoxGeometry(), width: 4, height: 4, depth: 4 };
  place(loading, createEntity('Cube', [cube, scriptOn(script(`${scriptsDir}/Spinner.ts`))]));

  const start = (await createScene(project.path, 'A', serializeScene(a))).scene.id;
  await createScene(project.path, 'B', serializeScene(directed()));
  await createScene(project.path, 'Loading', serializeScene(loading));
  const heavy = renderScene(recipe.heavy);
  place(heavy, createModelEntity(assetAt(manifest, heavyModel).id, 'Images'));
  await createScene(project.path, 'Heavy', serializeScene(heavy));
  // `A` starts the game, and the scene `createProject` made is not one of the four.
  await setStartScene(project.path, start);
  await deleteScene(project.path, project.sceneId);
  return project.path;
}
