import { pass, vec4 } from 'three/tsl';
import {
  Box3,
  BoxGeometry,
  Color,
  DirectionalLight,
  Fog,
  Frustum,
  Matrix4,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Scene,
  Texture,
  WebGPURenderer,
  type Camera,
  type Node,
} from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import {
  RenderHost,
  compileHidden,
  composeStack,
  drawLayers,
  type CompileRenderer,
  type LayerRenderer,
  type PostEffect,
} from '../../src/render/RenderHost';

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

describe('compileHidden', () => {
  /** A hidden scene root: a light and a box far from the origin. */
  function hiddenRoot(): { root: Object3D; box: Mesh } {
    const root = new Object3D();
    const box = new Mesh(new BoxGeometry(2, 2, 2));
    box.position.set(40, 5, -30);
    root.add(new DirectionalLight(), box);
    root.visible = false;
    root.updateMatrixWorld(true);
    return { root, box };
  }

  /** Records what each compile was handed, and whether the root was shown during it. */
  function compiler(fails = false): CompileRenderer & {
    seen: { shown: boolean; camera: Camera; stage: Scene | null | undefined }[];
  } {
    return {
      seen: [],
      compileAsync(scene, camera, stage) {
        this.seen.push({ shown: scene.visible, camera, stage });
        if (fails) throw new Error('compile failed');
        return Promise.resolve();
      },
    };
  }

  function shownWorldScene(): Scene {
    const shown = new Scene();
    shown.environment = new Texture();
    shown.fog = new Fog(new Color(0x808080), 1, 100);
    return shown;
  }

  it('shows the root for the call alone, against a stage with the world\'s environment and fog and no light', async () => {
    const { root } = hiddenRoot();
    const shown = shownWorldScene();
    const renderer = compiler();

    await compileHidden(renderer, root, shown);

    const [call] = renderer.seen;
    expect(call?.shown).toBe(true);
    expect(root.visible).toBe(false);
    expect(call?.stage?.environment).toBe(shown.environment);
    expect(call?.stage?.fog).toBe(shown.fog);
    expect(call?.stage?.children).toEqual([]);
  });

  it("frames the root's bounds with its camera", async () => {
    const { root, box } = hiddenRoot();
    const renderer = compiler();
    await compileHidden(renderer, root, new Scene());

    const camera = renderer.seen[0]?.camera;
    if (camera === undefined) throw new Error('no compile');
    camera.updateMatrixWorld();
    const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    expect(frustum.intersectsBox(new Box3().setFromObject(box))).toBe(true);
  });

  it('hides the root again when the call throws', () => {
    const { root } = hiddenRoot();
    expect(() => compileHidden(compiler(true), root, new Scene())).toThrow('compile failed');
    expect(root.visible).toBe(false);
  });
});
