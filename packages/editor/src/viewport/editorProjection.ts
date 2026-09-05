import type { SceneDoc } from '@three-studio/core';
import { bindScene, type SceneBinder, type SceneBinderOptions } from '@three-studio/runtime';
import { DirectionalLight, GridHelper, Group, HemisphereLight, Scene } from 'three/webgpu';
import { SelectionOutline } from './SelectionOutline';
import { ViewportOverlay } from './overlay/ViewportOverlay';

/**
 * Everything the Scene view puts in front of the author that a build will not.
 *
 * The list is the deliverable, not a convenience. Three modes project the same
 * `SceneDoc` — the Scene view, Play, and an exported build — and until this
 * existed the difference between the first and the other two was not written
 * down anywhere: it had to be deduced by reading a thousand lines of viewport.
 * A difference that is **stated** is a decision; a difference that has to be
 * **discovered** is what a bug report looks like.
 *
 * Each name is a `Group` parented directly to the projection's `Scene`, so the
 * whole of the editor's addition is `scene.children` minus the binder's root.
 * Anything that differs between the modes and is not on this list is a bug, and
 * the parity test is what says so.
 */
export const EDITOR_OVERLAYS = [
  'EditorGrid', // The two GridHelpers, the ground plane.
  'EntityMarkers', // The click target of whatever draws nothing.
  'SelectionHelpers', // Light cones and camera frustums, while selected.
  'SelectionOutline',
  'TransformGizmo',
  'FallbackLighting', // The only one that changes what is *lit*.
] as const;

export interface EditorProjectionOptions extends SceneBinderOptions {
  /**
   * The document to project, expanded.
   *
   * Named `scene` and required, like `EngineOptions.scene`, because the two are
   * the halves this projection exists to keep comparable: an argument list that
   * differs is a difference the parity test cannot see.
   */
  scene: SceneDoc;
}

/**
 * The Scene view's half of the projection.
 *
 * What the editor's three.js `Scene` holds, and nothing about how it is drawn:
 * no renderer, no canvas, no frame loop, no Play cycle. That is the whole point
 * of the file. Those belong to `EditorViewport`, which owns a GPU device and
 * therefore cannot be built in a test — while everything worth comparing
 * against a running `Engine` is right here, and builds under bare Node.
 *
 * `renderer` stays optional, which is the type saying the same thing: the one
 * job that needs a device is capturing an analytic sky, and a projection built
 * without one is left on its background colour rather than failing.
 */
export interface EditorProjection {
  readonly scene: Scene;
  readonly binder: SceneBinder;
  readonly overlay: ViewportOverlay;
  readonly outline: SelectionOutline;
  /**
   * Empty as built. `TransformControls` needs a canvas, so the viewport is what
   * fills this in — but the name has to be here, or the projection would be
   * missing one of its six only when nobody was holding a mouse.
   */
  readonly transformGizmo: Group;
  readonly fallbackLighting: Group;
}

export function createEditorProjection(options: EditorProjectionOptions): EditorProjection {
  const { scene: doc, ...binderOptions } = options;

  const scene = new Scene();
  // The named constructor, so the four ordering constraints this depends on are
  // read where they are written down rather than restated here. It also puts
  // `binder.root` into the scene, which is why the overlays go in afterwards:
  // the six that remain, in order, are exactly `EDITOR_OVERLAYS`.
  const binder = bindScene(scene, doc, binderOptions);

  const overlay = new ViewportOverlay(binder);
  const outline = new SelectionOutline();
  const transformGizmo = new Group();
  transformGizmo.name = 'TransformGizmo';
  const fallbackLighting = buildFallbackLighting();

  /*
   * Children of the `Scene` itself, whose matrix is the identity — and that is
   * a requirement, not a tidy default. Three's light and camera helpers take
   * the world matrix of whatever they annotate as their own, so a parent
   * carrying a transform would offset every one of them. They used to hang from
   * a container group for exactly this reason; a `Scene` is the same guarantee
   * with one fewer node, and one that cannot be given a transform by accident.
   */
  scene.add(
    buildGrid(),
    overlay.markers,
    overlay.annotations,
    outline.root,
    transformGizmo,
    fallbackLighting,
  );

  return { scene, binder, overlay, outline, transformGizmo, fallbackLighting };
}

function buildGrid(): Group {
  const grid = new Group();
  grid.name = 'EditorGrid';

  // Two tiers, like Unity: metre cells near the origin, ten-metre cells beyond.
  // Values are well above the background so the ground plane reads at a glance.
  const fine = new GridHelper(200, 200, 0x7d858e, 0x4d545b);
  const coarse = new GridHelper(2000, 200, 0x8a939d, 0x5a6269);
  coarse.position.y = -0.001; // Avoid z-fighting with the fine grid.

  for (const helper of [fine, coarse]) {
    const material = helper.material;
    material.transparent = true;
    material.opacity = 0.85;
    material.depthWrite = false;
    helper.renderOrder = -1;
    grid.add(helper);
  }
  return grid;
}

/**
 * The pair a scene with no lights of its own is lit by.
 *
 * Switched on and off by whoever holds the document — see `EditorViewport`. A
 * scene that renders black reads as a broken editor rather than as "you have
 * not added a light yet", which is why this exists at all, and it is the one
 * overlay that changes what a build would *show* rather than what it draws on
 * top. T-012 is what makes it say so out loud.
 */
function buildFallbackLighting(): Group {
  const group = new Group();
  group.name = 'FallbackLighting';

  const sky = new HemisphereLight(0xbfd4e8, 0x3a3428, 1.1);
  const sun = new DirectionalLight(0xffffff, 2.2);
  sun.position.set(12, 18, 8);
  group.add(sky, sun);
  return group;
}
