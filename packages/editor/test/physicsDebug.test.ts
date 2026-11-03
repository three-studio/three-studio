import type { DebugLines } from '@three-studio/runtime';
import { BufferAttribute, LineSegments } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { PhysicsDebug } from '../src/viewport/PhysicsDebug';

/*
 * Rapier's debug view laid over the running game: the lines the world hands,
 * copied into one `LineSegments` of a scene of its own, and only when they are
 * new, since the world hands the same arrays again until its next tick.
 */

/** `count` white segments. */
function segments(count: number): DebugLines {
  return {
    vertices: Float32Array.from({ length: count * 6 }, (_, i) => i),
    colors: new Float32Array(count * 8).fill(1),
  };
}

/** How many points the scene's lines draw, and the attributes they read. */
function drawn(debug: PhysicsDebug) {
  const [lines] = debug.scene.children;
  if (!(lines instanceof LineSegments)) throw new Error('The scene holds no lines.');
  const position = lines.geometry.getAttribute('position');
  const color = lines.geometry.getAttribute('color');
  if (!(position instanceof BufferAttribute) || !(color instanceof BufferAttribute)) {
    throw new Error('The lines have no position or colour attribute.');
  }
  return { points: lines.geometry.drawRange.count, position, color };
}

describe('the debug view over the game', () => {
  it('draws the lines it is handed, grows its buffers, and copies nothing twice', () => {
    const debug = new PhysicsDebug();

    debug.show(segments(2));
    expect(drawn(debug).points).toBe(4);

    const ten = segments(10);
    debug.show(ten);
    const grown = drawn(debug);
    expect(grown.points).toBe(20);
    expect(grown.position.count).toBeGreaterThanOrEqual(20);
    expect(Array.from(grown.position.array.subarray(0, 60))).toEqual(Array.from(ten.vertices));
    // Rapier's RGBA, alpha included.
    expect(grown.color.itemSize).toBe(4);
    expect(Array.from(grown.color.array.subarray(0, 80))).toEqual(Array.from(ten.colors));

    const versions = [grown.position.version, grown.color.version];
    debug.show(ten);
    expect([drawn(debug).position.version, drawn(debug).color.version]).toEqual(versions);

    // Fewer lines draw fewer points from the buffers they have.
    debug.show(segments(1));
    expect(drawn(debug).points).toBe(2);
    expect(drawn(debug).position).toBe(grown.position);

    debug.dispose();
  });
});
