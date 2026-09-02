import { createSkySettings } from '@three-studio/core';
import { Group, Mesh, PerspectiveCamera, Scene } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { ProceduralSky } from '../../src/systems/sky';

/*
 * The analytic sky, on its own.
 *
 * Testable under Node for the reason `sceneBinder.test.ts` gives: `three/webgpu`
 * constructs without a device, and `onBeforeRender` is an ordinary function a
 * test can call. What must never appear here is a renderer — `radiance` wants a
 * real one, and nothing below asks for it.
 */

/** The sky as it is attached: one mesh, directly on the scene. */
function attached(): { scene: Scene; mesh: Mesh } {
  const scene = new Scene();
  new ProceduralSky().attach(scene, createSkySettings(), 1);
  const mesh = scene.children[0];
  if (!(mesh instanceof Mesh)) throw new Error('the sky did not attach');
  return { scene, mesh };
}

/** What the renderer does, with only the argument the hook reads. */
function draw(mesh: Mesh, scene: Scene, camera: PerspectiveCamera): void {
  scene.updateMatrixWorld(true);
  mesh.onBeforeRender(
    null as never,
    scene,
    camera,
    mesh.geometry,
    mesh.material as never,
    null as never,
  );
}

describe('the analytic sky', () => {
  it('follows a camera sitting at the root, which is the editor’s', () => {
    const { scene, mesh } = attached();
    const camera = new PerspectiveCamera();
    camera.position.set(8, 6, 12);
    scene.add(camera);

    draw(mesh, scene, camera);

    expect(mesh.position.toArray()).toEqual([8, 6, 12]);
  });

  /*
   * The one that was failing. In play mode `CameraSystem` hands the camera to
   * the reconciler, which parents it under its entity's container — and the
   * player controller moves the *container*, leaving `camera.position` an eye
   * height near nothing. A sky placed from that stayed at the origin, outside
   * its own ten-unit box, and the game rendered a black sky while the water
   * went on reflecting one.
   */
  it('follows a camera parented under its entity, which is play mode’s', () => {
    const { scene, mesh } = attached();
    const container = new Group();
    container.position.set(120, 0, -45);
    const camera = new PerspectiveCamera();
    // What `PlayerController` writes: an eye height, in the entity's frame.
    camera.position.set(0, 1.7, 0);
    container.add(camera);
    scene.add(container);

    draw(mesh, scene, camera);

    expect(mesh.position.toArray()).toEqual([120, 1.7, -45]);
  });

  it('follows a rotated rig, not just a moved one', () => {
    const { scene, mesh } = attached();
    const container = new Group();
    container.position.set(0, 0, 50);
    container.rotation.y = Math.PI / 2;
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, -10);
    container.add(camera);
    scene.add(container);

    draw(mesh, scene, camera);

    // Rotated a quarter turn, the rig's local -Z points down world -X.
    expect(mesh.position.x).toBeCloseTo(-10);
    expect(mesh.position.z).toBeCloseTo(50);
  });
});
