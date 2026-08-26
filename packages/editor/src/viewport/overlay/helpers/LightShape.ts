import type { LightComponent } from '@three-studio/core';
import { RectAreaLightHelper } from 'three/addons/helpers/RectAreaLightHelper.js';
import {
  DirectionalLight,
  DirectionalLightHelper,
  HemisphereLight,
  HemisphereLightHelper,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  RectAreaLight,
  SphereGeometry,
  SpotLight,
  SpotLightHelper,
  Vector3,
  type Object3D,
} from 'three/webgpu';
import { annotation, type ComponentHelper, type HelperHandle } from '../ComponentHelper';

/**
 * Side of the directional light's plane, in world units.
 *
 * Small on purpose. three defaults it to 1, which draws a **two-metre** square —
 * seen from an editor camera a few decimetres away it fills the view, projects
 * asymmetrically and reads as a helper that has come loose from its light. It
 * never had: `DirectionalLightHelper` takes `light.matrixWorld` by reference, so
 * it is always exactly on it. It was only far too big to look like it.
 */
const PLANE_SIZE = 0.2;

/** Side of the hemisphere light's octahedron, for the same reason. */
const SKY_SIZE = 0.2;

/**
 * How long to draw a cone, or how wide to draw a range sphere, when the light's
 * range is unbounded.
 *
 * `distance: 0` means "no falloff limit" and is what `createLight` gives every
 * new spot and point light, so this is the common case rather than the edge one.
 * `SpotLightHelper` answers it with a cone of **a thousand units**, which is not
 * wrong so much as unusable: what the cone is for is reading the angle, and an
 * angle is read near the apex.
 */
const UNBOUNDED_RANGE = 5;

/**
 * The shape of a selected light, for every kind that has one.
 *
 * Only **ambient** draws nothing, and it is the one kind for which that is not a
 * shortfall: it has neither a position nor a direction nor an extent, so its
 * marker already says everything true about it.
 *
 * The `switch` is exhaustive over `LightKind` and has no `default`, so a new
 * kind fails to compile here rather than shipping a light with nothing to see —
 * which is how `rectArea` and `projector` were caught. Each branch narrows the
 * source with `instanceof` instead of trusting the component: the two can
 * disagree for exactly one frame, between the document changing and the binder
 * reconciling it. `projector` is checked before `spot` for the same reason it
 * shares its branch — `ProjectorLight` extends `SpotLight`, so the narrowing
 * holds, but the component is what says which of the two this is.
 */
export class LightShape implements ComponentHelper<'light'> {
  readonly type = 'light';

  mount(component: LightComponent, source: Object3D): HelperHandle | null {
    switch (component.kind) {
      case 'directional':
        return source instanceof DirectionalLight
          ? annotation(new DirectionalLightHelper(source, PLANE_SIZE))
          : null;
      case 'spot':
      case 'projector':
        // A projector is a spot that throws a picture. The cone is the same
        // shape and answers the same question: where does this land?
        return source instanceof SpotLight ? spotCone(source) : null;
      case 'rectArea':
        // The only helper here that is not an annotation of the light but the
        // light itself: the outline traces the emitting rectangle, so it is
        // what `width` and `height` are edited against.
        return source instanceof RectAreaLight
          ? annotation(new RectAreaLightHelper(source))
          : null;
      case 'point':
        return source instanceof PointLight ? rangeSphere(source) : null;
      case 'hemisphere':
        return source instanceof HemisphereLight
          ? annotation(new HemisphereLightHelper(source, SKY_SIZE))
          : null;
      case 'ambient':
        return null;
    }
  }
}

/**
 * A spot's cone, re-sized after three has oriented and coloured it.
 *
 * `SpotLightHelper.update` writes `cone.scale` from `light.distance || 1000`;
 * this writes it again from a range an author can see. Scale only — the
 * orientation `update` computed from the light's target is untouched, which is
 * why this runs after it rather than in place of it.
 */
function spotCone(light: SpotLight): HelperHandle {
  const helper = new SpotLightHelper(light);
  const resize = (): void => {
    const range = light.distance > 0 ? light.distance : UNBOUNDED_RANGE;
    const width = range * Math.tan(light.angle);
    helper.cone.scale.set(width, width, range);
  };
  resize();
  return annotation(helper, resize);
}

/**
 * A point light's reach, as a wireframe sphere at its range.
 *
 * Not `PointLightHelper`, which draws a fixed four-segment sphere sized by a
 * constructor argument and never again — so it says only what the marker
 * already says, and says it at the wrong size as soon as the range is edited.
 * three's own source has the interesting version commented out, a sphere of the
 * light's actual range, and that is what this is.
 *
 * Written as a subclass rather than assembled inline so it arrives at
 * `annotation` in the shape three's helpers have — an `Object3D` carrying
 * `update` and `dispose` — instead of needing a cast to get there.
 */
class PointRange extends Mesh<SphereGeometry, MeshBasicMaterial> {
  private readonly scratch = new Vector3();

  constructor(private readonly light: PointLight) {
    super(
      new SphereGeometry(1, 16, 8),
      new MeshBasicMaterial({ wireframe: true, fog: false, toneMapped: false }),
    );
    // The world matrix is composed here rather than inherited, so `update` can
    // scale it without touching the light's own — three's helpers take
    // `light.matrixWorld` by reference, and scaling that would move the light.
    this.matrixAutoUpdate = false;
    this.update();
  }

  update(): void {
    this.material.color.copy(this.light.color);
    const range = this.light.distance > 0 ? this.light.distance : UNBOUNDED_RANGE;
    this.matrix.copy(this.light.matrixWorld).scale(this.scratch.setScalar(range));
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

function rangeSphere(light: PointLight): HelperHandle {
  return annotation(new PointRange(light));
}
