import { deltaTime, time } from 'three/tsl';

/*
 * The application's clock, and the only one.
 *
 * There used to be two. The simulation ran on a delta computed and clamped by
 * whoever owned the render loop; the shaders ran on `NodeFrame.time`, which
 * three advances by itself from `performance.now()` on every animation frame
 * (`three/src/nodes/core/NodeFrame.js`). Nothing kept them together: Pause
 * stopped the first and not the second, a backgrounded tab moved the second and
 * not the first, and there was no timescale at all. `SceneBinder.skyAnimated`
 * was a workaround for that gap, written for the one shader that had noticed.
 */

/**
 * How the simulation's clock reaches every node material.
 *
 * three's `time` and `deltaTime` are module singletons, and `Node.onUpdate`
 * *replaces* a node's update callback rather than adding to it. So `install`
 * re-points them at this object, and every TSL material in the document —
 * `WaterMesh`, `SkyMesh`, a future shader asset, a user's own — reads the
 * simulation without being told it exists. That is the whole design: three
 * already built the publish channel, and a uniform is a better one than any
 * listener list we could add.
 *
 * Consumers receive an instance through `SystemContext` and `BehaviourContext`
 * rather than importing {@link studioTime}. The singleton exists because three's
 * nodes are singletons — there can be exactly one authoritative clock per
 * document — but nothing downstream should have to know that.
 */
export class StudioTime {
  private seconds = 0;
  private lastDelta = 0;
  private rate = 1;

  /** Seconds of simulated time since the clock started. What `time` reads. */
  get elapsed(): number {
    return this.seconds;
  }

  /** The last frame's simulated delta, already scaled. What `deltaTime` reads. */
  get delta(): number {
    return this.lastDelta;
  }

  get timescale(): number {
    return this.rate;
  }

  /**
   * 0 pauses, 1 is real time, 0.25 is slow motion.
   *
   * Negative and non-finite values are refused rather than clamped: a shader
   * fed a rewinding clock is a bug report about the shader, and `NaN` reaching
   * a uniform poisons every material sharing the render group.
   */
  set timescale(value: number) {
    if (!Number.isFinite(value) || value < 0) return;
    this.rate = value;
  }

  /**
   * Re-points three's global TSL clock at this one.
   *
   * Explicit, and never a side effect of importing this module: the launcher is
   * a separate document with its own renderer and its own animation, and it has
   * no reason to inherit a decision the editor made. Called once by whoever owns
   * the render loop, and safe to call again — `onUpdate` overwrites.
   *
   * `frameId` is deliberately left alone. It is a counter, and a counter that
   * stops during Pause would break any shader accumulating over frames, which
   * is the one thing frame ids are for.
   */
  install(): void {
    // `UniformNode.onUpdate` assigns whatever the callback returns, so these two
    // lines are the entire binding. Arrow functions on purpose: three binds the
    // callback to the *node*, and an arrow keeps `this` pointing here.
    time.onRenderUpdate(() => this.seconds);
    deltaTime.onRenderUpdate(() => this.lastDelta);
  }

  /**
   * One animation frame.
   *
   * @param raw Real seconds since the previous frame, already clamped by the
   *   caller. Clamping stays with the render loop because it is the render loop
   *   that knows what a missed frame means there — a backgrounded editor tab and
   *   a stalled exported build want the same ceiling for different reasons.
   */
  advance(raw: number): void {
    if (!Number.isFinite(raw) || raw < 0) return;
    this.lastDelta = raw * this.rate;
    this.seconds += this.lastDelta;
  }

  /**
   * One fixed step, whatever the timescale says.
   *
   * This is the Step button. It has to move a paused clock, which is exactly
   * what `advance` must not do, so it is a second method rather than a flag —
   * the two callers want opposite things from the same numbers.
   */
  step(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    this.lastDelta = seconds;
    this.seconds += seconds;
  }
}

/**
 * The document's clock.
 *
 * A module instance because three's `time` node is one: two of these installed
 * in the same document would fight over the same callback, and the loser would
 * be whichever called `install` first. Reach it here only if you own the render
 * loop; everything else is handed one.
 */
export const studioTime = new StudioTime();
