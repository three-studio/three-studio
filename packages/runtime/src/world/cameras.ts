import type { Disposable } from '@three-studio/core';
import { OrthographicCamera, PerspectiveCamera, type Camera } from 'three/webgpu';

/**
 * How strongly each kind of camera claims the view. Something driving the view
 * — a player, a vehicle, a cutscene rig — is the view you are in, over the
 * camera a scene marks main, over any other the scene holds.
 */
export const CAMERA_PRIORITY = { driven: 2, main: 1, authored: 0 } as const;

interface Claim {
  readonly camera: Camera;
  readonly priority: number;
}

/**
 * Which camera a world is drawn through: whoever claims the view, the highest
 * priority winning and the first to claim among equals, else a default view.
 *
 * Claimed by what owns a camera — the camera component as it mounts, a
 * behaviour driving one — so that the world names none of them, and answered
 * by a field: a host asks once per frame.
 */
export class CameraClaims {
  private readonly claims: Claim[] = [];
  /** Posed as the world always posed it: looking at the origin from up and back. */
  private readonly fallback = new PerspectiveCamera(60, 16 / 9, 0.1, 5000);
  private current: Camera;
  /** What the host last said, kept for a camera that claims afterwards; `null` until it says. */
  private aspect: number | null = null;

  constructor() {
    this.fallback.position.set(8, 6, 12);
    this.fallback.lookAt(0, 0, 0);
    this.current = this.fallback;
  }

  /** The camera to draw through now. */
  get active(): Camera {
    return this.current;
  }

  /** Claims the view for `camera` at `priority` until the result is disposed. */
  claim(camera: Camera, priority: number): Disposable {
    const claim: Claim = { camera, priority };
    this.claims.push(claim);
    if (this.aspect !== null) fit(camera, this.aspect);
    this.choose();
    let held = true;
    return {
      dispose: () => {
        if (!held) return;
        held = false;
        const at = this.claims.indexOf(claim);
        if (at >= 0) this.claims.splice(at, 1);
        this.choose();
      },
    };
  }

  /**
   * Fits every camera that claims the view, and the default one, to a canvas
   * of this width over height — and every one that claims it later.
   *
   * One rule for every host: a perspective camera takes the aspect, and an
   * orthographic one keeps the vertical extent the document gave it and widens
   * to the canvas. The editor's Play used to fit perspective cameras alone, so
   * an orthographic scene was stretched there and right in a build.
   */
  setAspect(aspect: number): void {
    this.aspect = aspect;
    fit(this.fallback, aspect);
    for (const { camera } of this.claims) fit(camera, aspect);
  }

  /** What is wrong with the view, said once the world is built. */
  diagnose(): readonly string[] {
    return this.claims.length === 0 ? ['No camera and no player controller; using a default view.'] : [];
  }

  private choose(): void {
    let chosen: Claim | null = null;
    for (const claim of this.claims) {
      if (chosen === null || claim.priority > chosen.priority) chosen = claim;
    }
    this.current = chosen?.camera ?? this.fallback;
  }
}

function fit(camera: Camera, aspect: number): void {
  if (camera instanceof PerspectiveCamera) {
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  } else if (camera instanceof OrthographicCamera) {
    // The document stores a vertical extent; the width follows the canvas.
    const height = (camera.top - camera.bottom) / 2;
    camera.left = -height * aspect;
    camera.right = height * aspect;
    camera.updateProjectionMatrix();
  }
}
