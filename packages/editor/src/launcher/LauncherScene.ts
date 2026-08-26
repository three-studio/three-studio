import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { color, pass } from 'three/tsl';
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  OrthographicCamera,
  RenderPipeline,
  Scene,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';

/**
 * The field of blocks behind the project list.
 *
 * A real scene rather than a picture, because it is the one thing on that
 * window that says what the app is. It uses the same renderer the editor does,
 * so it costs no dependency and no second build of three — only a GPU device,
 * released when the launcher window goes away.
 *
 * The composition is one idea: the blocks are the **same colour as the panel
 * they sit on**, so the field reads as the surface itself rising rather than as
 * an object placed on it, and the only thing the eye catches is the light
 * escaping from underneath. A ring wave runs outwards from the centre, and the
 * gaps between blocks open and close as it passes.
 *
 * The launcher must be on screen before anyone notices it was not, and a device
 * request that fails must leave a window that still works.
 */

/** Exactly `--color-surface-1`: the blocks *are* the panel. */
const PANEL = 0x242424;
/** The light under the field. A cooler, brighter relative of `--color-accent`. */
const GLOW = 0x55CCFF;

/**
 * Odd, so one block sits dead centre and the rings are symmetric about it.
 *
 * Wide enough that its edges are outside the frame: a field with a visible rim
 * is a tray of blocks, and the whole point is that it reads as the panel itself.
 * The far edge is dissolved by fog rather than by distance, which is cheaper
 * than making the grid big enough to reach the horizon.
 */
const GRID = 45;
/** Centre-to-centre. The block is smaller, and the difference is the gap. */
const PITCH = 1;
const BLOCK = 0.8;
/**
 * Columns, deep enough to hide their own feet.
 *
 * What the eye reads is the cap and a little of the flank; the rest exists so
 * that the lit plane below is seen *past* the field rather than through gaps in
 * it, which is where the glare comes from.
 */
const HEIGHT = 3.2;
/**
 * The lit sill under a block, barely wider than the block itself.
 *
 * Under perspective it needed real overhang to be seen at all. Orthographic has
 * no convergence to hide behind: every sill in the field shows the same amount
 * at once, so the same overhang turns the panel into a lit grid. A sliver is
 * enough now.
 */
const SILL = 0.83;
const SILL_THICKNESS = 0.045;
/** World units the frustum covers vertically. Lower is a closer crop. */
const VIEW_HEIGHT = 21;

export class LauncherScene {
  private readonly scene = new Scene();
  /**
   * Orthographic, so the field has no vanishing point.
   *
   * Under perspective the near rows are huge and the far ones vanish, and the
   * ring pattern is legible in one band across the middle. Without convergence
   * every block is the same size wherever it stands, the rings stay circular
   * from edge to edge, and the whole thing reads as a drawing rather than as a
   * photograph — which is the "classe" the brief asked for.
   */
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  private readonly root = new Group();
  private readonly geometry = new BoxGeometry(BLOCK, HEIGHT, BLOCK);
  private readonly sillGeometry = new BoxGeometry(SILL, SILL_THICKNESS, SILL);
  private sillMaterial: MeshBasicNodeMaterial | null = null;
  private sills: InstancedMesh | null = null;
  private readonly material: MeshStandardNodeMaterial;
  private readonly matrix = new Matrix4();
  private readonly offset = new Vector3();
  /** Distance from the centre, per instance: the wave's only input. */
  private readonly distances: number[] = [];

  private field: InstancedMesh | null = null;
  private renderer: WebGPURenderer | null = null;
  private pipeline: RenderPipeline | null = null;
  private observer: ResizeObserver | null = null;
  private disposed = false;
  private startTime = 0;

  private constructor(private readonly canvas: HTMLCanvasElement) {
    this.material = this.buildMaterial();
  }

  /**
   * Builds the scene and starts drawing.
   *
   * Resolves `null` when no device could be had — a machine without WebGPU, or
   * a driver that refused. The launcher then simply has an empty panel, which
   * is a far better outcome than a picker that will not open.
   */
  static async create(canvas: HTMLCanvasElement): Promise<LauncherScene | null> {
    const instance = new LauncherScene(canvas);
    try {
      await instance.start();
      return instance;
    } catch (cause) {
      console.warn('[launcher] the illustration could not start; carrying on without it.', cause);
      instance.dispose();
      return null;
    }
  }

  private async start(): Promise<void> {
    // Opaque, in the panel's own colour. Alpha would put the bloom's halo over
    // whatever is behind the canvas, and the panel is this colour anyway — so
    // there is nothing to see through to.
    const renderer = new WebGPURenderer({ canvas: this.canvas, antialias: true });
    await renderer.init();
    if (this.disposed) {
      renderer.dispose();
      return;
    }
    this.renderer = renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = new Color(PANEL);
    // Panel-coloured, so the far rows fade into the surface instead of stopping
    // at a visible edge. This is what makes a finite grid read as endless.
    this.scene.fog = new Fog(PANEL, 26, 62);

    this.buildField();
    this.buildSills();
    this.buildLights();
    // Seen along a diagonal, so the blocks read as diamonds and — the reason
    // that matters — the corridors between columns are no longer aligned with
    // the eye. Straight on, every gap is a slot you can see the far fog
    // through, and the field is striped with vertical lines.
    this.root.rotation.y = Math.PI / 4;
    this.scene.add(this.root);

    /*
     * Two constraints pull against each other here.
     *
     * The dive angle has to be shallow, because the light leaves through the
     * *sides* of the gaps and a steep camera cannot see into them — but not so
     * shallow that the rings flatten into a wall of edges.
     *
     * And it has to be close. An earlier pass framed the whole field from far
     * back and rendered a beautifully lit scene with no visible light in it: at
     * that distance every slot the light comes through was less than a pixel
     * wide.
     */
    // Position sets the angle only; the frustum below sets the zoom. Raised
    // enough for the rings to open out, since an orthographic camera cannot buy
    // that back with distance.
    this.camera.position.set(0, 10.5, 24);
    this.camera.lookAt(0, 0, 0);

    // A high threshold and a tight radius: only what has already clipped throws
    // a halo, and that halo stays close to it. A wide radius spreads the same
    // energy into a haze over the whole panel, which is the difference between
    // a light too bright to look at and a blurry photograph.
    this.pipeline = new RenderPipeline(renderer);
    const scenePass = pass(this.scene, this.camera);
    this.pipeline.outputNode = scenePass.add(bloom(scenePass, 0.85, 0.4, 0.66));

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.canvas);
    this.resize();

    this.startTime = performance.now();
    void renderer.setAnimationLoop(() => this.tick());
  }

  /**
   * The block surface. Panel-coloured, and lit rather than glowing.
   *
   * An earlier pass drove the light from an emissive node keyed on
   * `positionLocal.y`, which produced nothing: on an `InstancedMesh` that
   * attribute is not the height within a column that it looks like. What had
   * been read as a glow was the grazing light all along, so the light is now
   * the only mechanism and the material has no tricks in it.
   */
  private buildMaterial(): MeshStandardNodeMaterial {
    return new MeshStandardNodeMaterial({
      color: new Color(PANEL),
      // Rough enough not to show a specular streak from a light this strong,
      // smooth enough that the lit flanks keep a gradient rather than a flat
      // wash.
      roughness: 0.48,
      metalness: 0.15,
    });
  }

  /**
   * One instanced draw for the whole field.
   *
   * Two and a half thousand separate meshes would be two and a half thousand
   * draws for a decoration on a window that has to open instantly. Every block
   * is the same box and the same material; only the matrix differs, which is
   * exactly what instancing is.
   */
  private buildField(): void {
    const count = GRID * GRID;
    const field = new InstancedMesh(this.geometry, this.material, count);
    const half = (GRID - 1) / 2;

    for (let index = 0; index < count; index++) {
      const column = (index % GRID) - half;
      const row = Math.floor(index / GRID) - half;
      this.distances.push(Math.hypot(column, row) * PITCH);
    }

    field.castShadow = true;
    field.receiveShadow = true;
    this.field = field;
    this.root.add(field);
    this.writeMatrices(0);
  }

  /**
   * Where every block stands at `elapsed`.
   *
   * A single radial wave: height depends on distance from the centre and on
   * time, and the minus sign is what sends the rings *outwards*. Amplitude falls
   * off with distance so the far edge of the field settles into a flat horizon
   * instead of jittering at the vanishing point.
   */
  private writeMatrices(elapsed: number): void {
    const field = this.field;
    if (!field) return;

    const half = (GRID - 1) / 2;
    for (let index = 0; index < this.distances.length; index++) {
      const distance = this.distances[index]!;
      const falloff = 1 / (1 + distance * 0.05);
      const wave = Math.sin(distance * 0.72 - elapsed * 1.1) * 0.5 * falloff;
      // A second, slower ring at a different frequency, so the pattern does not
      // repeat visibly every few seconds.
      const secondary = Math.sin(distance * 0.27 - elapsed * 0.42) * 0.17 * falloff;

      this.offset.set(
        ((index % GRID) - half) * PITCH,
        // The column hangs below its cap, so the wave is where its *top* lands.
        wave + secondary - HEIGHT / 2,
        (Math.floor(index / GRID) - half) * PITCH,
      );
      this.matrix.makeTranslation(this.offset.x, this.offset.y, this.offset.z);
      field.setMatrixAt(index, this.matrix);

      // Just under the block's *cap*, riding with it. `offset.y` is already the
      // column's centre, i.e. the wave minus half the height, so the cap is
      // half a height above it again.
      this.matrix.makeTranslation(
        this.offset.x,
        this.offset.y + HEIGHT / 2 - 0.26,
        this.offset.z,
      );
      this.sills?.setMatrixAt(index, this.matrix);
    }
    field.instanceMatrix.needsUpdate = true;
    if (this.sills) this.sills.instanceMatrix.needsUpdate = true;
  }

  /**
   * The light, as a thin lit sill belonging to each block.
   *
   * Three ways of doing this failed first, and each failed for its own reason
   * worth remembering. A grazing light cannot make the blocks blinding: their
   * albedo is `#242424`, so `0.018 × intensity` stays inside the display range
   * however hard it is driven, and nothing that cannot clip looks overexposed.
   * An emissive node keyed on `positionLocal.y` produces nothing on an
   * `InstancedMesh`. And a lit plane under the field is sealed between the
   * columns: it can only be seen where it extends *past* them, which is a bar
   * along the horizon rather than light between the blocks.
   *
   * So the source is its own geometry, one instance per block, slightly wider
   * than the block it sits under — it therefore shows past the edge by
   * construction, from any angle, with no occlusion to reason about. Unlit and
   * over 1, so it clips to white and the bloom turns it to glare.
   */
  private buildSills(): void {
    const material = new MeshBasicNodeMaterial();
    material.colorNode = color(GLOW).mul(0.82);
    this.sillMaterial = material;

    const sills = new InstancedMesh(this.sillGeometry, material, GRID * GRID);
    this.sills = sills;
    this.root.add(sills);
  }

  private buildLights(): void {
    /*
     * Almost horizontal, and from *below* the caps. That angle is the whole
     * effect: its dot product with a face pointing up is negative, so the tops
     * take nothing from it however strong it gets and stay exactly the colour of
     * the panel — while a flank the wave has exposed takes it full on.
     *
     * Strong enough to clip. The brief asked for blinding rather than blurry,
     * and a value inside the display range can only ever look bright: the core
     * of a lit flank has to blow out to white before the bloom around it reads
     * as glare rather than as a smudge.
     */
    const grazing = new DirectionalLight(GLOW, 6);
    grazing.position.set(0, -1.4, 14);

    // The same light from the far side, so the rings read on both slopes rather
    // than only on the ones facing the camera.
    const back = new DirectionalLight(GLOW, 1.8);
    back.position.set(-6, -1.1, -12);

    // Barely there. The moment the tops read as lit, the blocks stop being the
    // panel and the illusion goes with them.
    const key = new DirectionalLight(0xdfe7f5, 2.4);
    key.position.set(-6, 9, 4);

    this.scene.add(grazing, back, key, new AmbientLight(0x2a3140, 2.9));
  }

  private resize(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (!this.renderer || width === 0 || height === 0) return;

    this.renderer.setSize(width, height, false);
    // Height is what is held constant: the panel is portrait and fixed, so a
    // wider window should show more field rather than a smaller one.
    const halfHeight = VIEW_HEIGHT / 2;
    const halfWidth = halfHeight * (width / height);
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
  }

  private tick(): void {
    if (!this.renderer || !this.pipeline || this.disposed) return;
    const elapsed = (performance.now() - this.startTime) / 1000;

    this.writeMatrices(elapsed);
    this.pipeline.render();
  }

  dispose(): void {
    this.disposed = true;
    this.observer?.disconnect();
    this.observer = null;

    if (this.renderer) {
      void this.renderer.setAnimationLoop(null);
      this.renderer.dispose();
      this.renderer = null;
    }

    this.pipeline = null;
    this.field?.dispose();
    this.field = null;
    this.geometry.dispose();
    this.sillGeometry.dispose();
    this.sills?.dispose();
    this.sills = null;
    this.sillMaterial?.dispose();
    this.sillMaterial = null;
    this.material.dispose();
    this.distances.length = 0;
    this.root.clear();
    this.scene.clear();
  }
}
