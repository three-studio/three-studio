import type { Disposable, EntityId, Hex, Vec3 } from '@three-studio/core';

/** A direction to be lit from, and the colour of what is lighting. */
export interface Sun {
  /** Unit vector pointing from the surface at the light. */
  readonly direction: Vec3;
  readonly color: Hex;
}

/** What answers for a sun: a light, or the sky. Asked when it is read, so it answers where it is then. */
export interface SunSource {
  sun(): Sun;
}

/**
 * Where a surface that shades itself takes its light from: a light entity's,
 * or the scene's sky for `null`.
 *
 * Provided by what knows each — a light as it mounts, the sky as the scene's
 * environment is read — and asked by what shades itself, water: so the binder
 * answers nothing about lights, and the world names no feature.
 */
export class SunService {
  private readonly lights = new Map<EntityId, SunSource>();
  private sky: SunSource | null = null;

  /** The sun of `light`, or the sky's for `null`; `null` when nothing provides it. */
  of(light: EntityId | null): Sun | null {
    const source = light === null ? this.sky : this.lights.get(light);
    return source?.sun() ?? null;
  }

  /** Answers for `light`, or for the sky with `null`, until the result is disposed. */
  provide(light: EntityId | null, source: SunSource): Disposable {
    if (light === null) this.sky = source;
    else this.lights.set(light, source);
    let provided = true;
    return {
      dispose: () => {
        if (!provided) return;
        provided = false;
        if (light === null) {
          if (this.sky === source) this.sky = null;
        } else if (this.lights.get(light) === source) {
          this.lights.delete(light);
        }
      },
    };
  }
}
