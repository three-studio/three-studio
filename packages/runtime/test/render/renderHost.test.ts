import { PerspectiveCamera, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { drawLayers, type LayerRenderer } from '../../src/render/RenderHost';

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
