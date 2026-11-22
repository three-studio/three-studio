import { pass, vec4 } from 'three/tsl';
import { PerspectiveCamera, Scene, WebGPURenderer, type Node } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { RenderHost, composeStack, drawLayers, type LayerRenderer, type PostEffect } from '../../src/render/RenderHost';

/**
 * A renderer never initialised, which is all a host holds until it draws: its
 * constructor makes a canvas, and Node has no document, so one is stood in for
 * the call and taken back.
 */
function rendererInNode(): WebGPURenderer {
  Reflect.set(globalThis, 'document', { createElementNS: () => ({ setAttribute() {}, style: {} }) });
  try {
    return new WebGPURenderer();
  } finally {
    Reflect.deleteProperty(globalThis, 'document');
  }
}

/** Records each render with the `autoClear` it was made under. */
function recorder(failOn?: Scene): LayerRenderer & { calls: { scene: unknown; autoClear: boolean }[] } {
  return {
    autoClear: true,
    calls: [],
    render(scene) {
      this.calls.push({ scene, autoClear: this.autoClear });
      if (scene === failOn) throw new Error('render failed');
    },
  };
}

describe('drawLayers', () => {
  const camera = new PerspectiveCamera();

  it('draws the scene, then the overlay uncleared, and puts autoClear back', () => {
    const scene = new Scene();
    const overlay = new Scene();
    const renderer = recorder();
    drawLayers(renderer, scene, camera, overlay);
    expect(renderer.calls).toEqual([
      { scene, autoClear: true },
      { scene: overlay, autoClear: false },
    ]);
    expect(renderer.autoClear).toBe(true);
  });

  it('puts autoClear back when the overlay fails to draw', () => {
    const overlay = new Scene();
    const renderer = recorder(overlay);
    expect(() => drawLayers(renderer, new Scene(), camera, overlay)).toThrow('render failed');
    expect(renderer.autoClear).toBe(true);
  });

  it('renders once with no overlay', () => {
    const renderer = recorder();
    drawLayers(renderer, new Scene(), camera, null);
    expect(renderer.calls).toHaveLength(1);
  });
});

describe('the post-processing stack', () => {
  it('folds its effects in order over the pass, each given the image so far and the pass', () => {
    const scene = pass(new Scene(), new PerspectiveCamera());
    const seen: [Node<'vec4'>, unknown][] = [];
    const first = vec4(1);
    const second = vec4(2);
    const effects: PostEffect[] = [
      (image, from) => {
        seen.push([image, from]);
        return first;
      },
      (image, from) => {
        seen.push([image, from]);
        return second;
      },
    ];
    expect(composeStack(effects, scene)).toBe(second);
    expect(seen).toEqual([
      [scene, scene],
      [first, scene],
    ]);
  });

  it('refuses an overlay on a host with an effect, in words', () => {
    const host = new RenderHost({ renderer: rendererInNode(), effects: [(image) => image] });
    expect(() => (host.overlay = new Scene())).toThrow(/post effect cannot draw an overlay/);
    expect(() => (host.overlay = null)).not.toThrow();
    const plain = new RenderHost({ renderer: rendererInNode() });
    const overlay = new Scene();
    plain.overlay = overlay;
    expect(plain.overlay).toBe(overlay);
  });
});
