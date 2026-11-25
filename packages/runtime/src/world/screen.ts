import type { Disposable } from '@three-studio/core';

/** What a world lays over the view it is drawn in, in front of its 3D image: DOM. */
export interface ScreenLayer {
  /** Laid over the whole view; inert to pointers except where it marks `pointer-events: auto`. */
  readonly element: HTMLElement;
  /** Back to front: a higher order in front; equal orders in the order added. */
  readonly order: number;
}

/**
 * A world's screen layers, back to front: the touch sticks today, a UI next.
 *
 * The world says what lies over its image, and the host showing it lays it
 * there (`RenderHost.show`): drawing and routing follow one stacking order, so
 * a pointer goes to the frontmost layer that takes it, then to the canvas the
 * game's `Input` listens on, and the two can never disagree.
 */
export class ScreenLayers {
  /** The host showing the world, told of each change. */
  onChange: (() => void) | null = null;
  private layers: readonly ScreenLayer[] = [];

  /** Back to front; the same array between changes, so a host can tell nothing moved. */
  get all(): readonly ScreenLayer[] {
    return this.layers;
  }

  add(layer: ScreenLayer): Disposable {
    // After every layer of its order or lower: a stable insertion.
    const at = this.layers.findIndex((other) => other.order > layer.order);
    this.layers = at < 0 ? [...this.layers, layer] : [...this.layers.slice(0, at), layer, ...this.layers.slice(at)];
    this.onChange?.();
    return {
      dispose: () => {
        if (!this.layers.includes(layer)) return;
        this.layers = this.layers.filter((other) => other !== layer);
        this.onChange?.();
      },
    };
  }
}
