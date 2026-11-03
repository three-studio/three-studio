import type { DebugLines } from '@three-studio/runtime';
import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments, Scene } from 'three/webgpu';

/**
 * Rapier's debug view, as the editor lays it over the running game: every
 * collider as the solver holds it, each body's axes and each joint, in
 * Rapier's own colours, which tell fixed, dynamic and kinematic bodies apart
 * and dim a sleeping one.
 *
 * A scene of its own, drawn onto the game's image (`ViewportRenderer.draw`'s
 * `over`). The running engine's scene carries nothing of the editor's, so that
 * what Play draws is what a build draws.
 */
export class PhysicsDebug {
  /** What `ViewportRenderer.draw` draws over the game. */
  readonly scene = new Scene();
  private readonly lines = new LineSegments(
    new BufferGeometry(),
    new LineBasicMaterial({
      // Rapier's RGBA as it is: three's vertex colour is a `vec4`.
      vertexColors: true,
      fog: false,
      toneMapped: false,
      // Over everything, as a collider's gizmo is: a collider lies on the faces
      // of the mesh it fits, and a depth test cut its lines into dashes.
      depthTest: false,
      depthWrite: false,
    }),
  );
  private positions = new BufferAttribute(new Float32Array(0), 3);
  private colors = new BufferAttribute(new Float32Array(0), 4);
  /** What was written last: the world hands the same arrays again until its next tick. */
  private shown: DebugLines | null = null;

  constructor() {
    this.lines.geometry.setAttribute('position', this.positions).setAttribute('color', this.colors);
    // Rewritten in place, so the bounding sphere three keeps would cull it.
    this.lines.frustumCulled = false;
    // Until there is something to draw: a world with no body hands no line.
    this.lines.visible = false;
    this.scene.add(this.lines);
  }

  /** The scene, holding these lines. Copies nothing it was handed last time. */
  show(lines: DebugLines): Scene {
    const { vertices, colors } = lines;
    if (vertices === this.shown?.vertices && colors === this.shown.colors) return this.scene;
    this.shown = lines;

    const points = vertices.length / 3;
    if (points > this.positions.count) this.grow(points);
    this.positions.copyArray(vertices);
    this.colors.copyArray(colors);
    this.positions.needsUpdate = true;
    this.colors.needsUpdate = true;
    this.lines.geometry.setDrawRange(0, points);
    this.lines.visible = points > 0;
    return this.scene;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    this.lines.material.dispose();
  }

  /**
   * Room for this many points at least, at twice the room there was: a scene
   * gaining a body now and then reallocates seldom, and one losing a body
   * reallocates nothing. A buffer cannot grow, so the geometry is a new one.
   */
  private grow(points: number): void {
    const room = Math.max(points, 2 * this.positions.count);
    this.positions = new BufferAttribute(new Float32Array(room * 3), 3);
    this.colors = new BufferAttribute(new Float32Array(room * 4), 4);
    this.lines.geometry.dispose();
    this.lines.geometry = new BufferGeometry()
      .setAttribute('position', this.positions)
      .setAttribute('color', this.colors);
  }
}
