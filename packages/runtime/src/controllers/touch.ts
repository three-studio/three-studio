import type { Disposable, TouchControlsMode } from '@three-studio/core';
import { inputOf } from '../input/inputOf';
import { ZERO } from '../input/VirtualControls';
import type { World } from '../world/World';
import { TouchControls } from './TouchControls';
import { shouldShowTouch } from './touchMath';

/** The virtual axes the sticks set, by these names, on the world's `Input`. */
export const MOVE_AXIS = 'move';
export const LOOK_AXIS = 'look';
/** The virtual keys the on-screen buttons press. */
const TOUCH_JUMP = 'Space';
const TOUCH_SPRINT = 'ShiftLeft';

/** A player controller's claim on the on-screen sticks: they stay while one claim does. */
export interface TouchHold extends Disposable {
  /** Whether the sticks are on screen, and so driving the view. */
  readonly shown: boolean;
}

/**
 * One set of sticks per world, however many player controllers ask: two sets
 * would be two sets of touch handlers fighting over the same thumbs. The first
 * hold's mode wins.
 */
class TouchSet {
  holds = 0;
  private controls: TouchControls | null = null;
  private layer: Disposable | null = null;
  /** A build already in flight, so a flurry of touches makes one overlay. */
  private building = false;
  private sawTouch = false;
  private sawMouse = false;
  private disposed = false;

  constructor(
    private readonly world: World,
    private readonly mode: TouchControlsMode,
  ) {
    // On the window rather than the canvas, which is what lets the tap on an
    // exported build's Start button be the one that summons the controls —
    // they are then already there when the game begins rather than costing a
    // first, wasted touch. Absent in Node, where nothing is ever built.
    if (typeof window === 'undefined') return;
    window.addEventListener('pointerdown', this.onAnyPointerDown, true);
    window.addEventListener('pointermove', this.onAnyPointerMove, true);
    this.sync();
  }

  get shown(): boolean {
    return this.controls !== null;
  }

  dispose(): void {
    this.disposed = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', this.onAnyPointerDown, true);
      window.removeEventListener('pointermove', this.onAnyPointerMove, true);
    }
    this.takeDown();
  }

  /*
   * What decides whether the sticks are on screen: what the player did, never
   * what the hardware claims to be. See `shouldShowTouch` for why every device
   * check gets this wrong.
   *
   * `sawMouse` is cleared here rather than latched, so the two signals can
   * trade places as often as someone puts a tablet in and out of its keyboard
   * case.
   */
  private readonly onAnyPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== 'touch') return;
    this.sawTouch = true;
    this.sawMouse = false;
    this.sync();
  };

  /*
   * `pointermove` with a `pointerType`, and never `mousemove`: a mobile browser
   * fires a **synthetic** mouse event after every tap, so watching for that one
   * would tear the controls down a few milliseconds after summoning them.
   *
   * A move rather than a down, because a mouse that is merely present should
   * not count — a hand resting on a trackpad beside a tablet is not someone
   * using it.
   */
  private readonly onAnyPointerMove = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' || this.sawMouse) return;
    this.sawMouse = true;
    this.sync();
  };

  private wanted(): boolean {
    return !this.disposed && shouldShowTouch(this.mode, this.sawTouch, this.sawMouse);
  }

  /** Builds or takes down the overlay to match what is currently true. */
  private sync(): void {
    if (!this.wanted()) {
      this.takeDown();
      return;
    }
    if (this.controls !== null || this.building) return;
    this.building = true;
    const input = inputOf(this.world);
    void TouchControls.create({
      place: (root) => (this.layer = this.world.screen.add({ element: root, order: 0 })),
      onMove: (move) => input?.setAxis(MOVE_AXIS, move),
      onLook: (look) => input?.setAxis(LOOK_AXIS, look),
      onJump: (down) => input?.setVirtualKey(TOUCH_JUMP, down),
      onSprint: (down) => input?.setVirtualKey(TOUCH_SPRINT, down),
    })
      .then((controls) => {
        // The import is a round trip, and a lot can happen across one: the
        // world can be torn down, or a mouse can arrive and settle the
        // question the other way. Either way what just finished building is
        // already unwanted.
        if (controls === null) return;
        this.controls = controls;
        if (!this.wanted()) this.takeDown();
      })
      .catch((cause: unknown) => {
        console.error('[input] the on-screen controls could not be built:', cause);
      })
      .finally(() => {
        this.building = false;
      });
  }

  /** The sticks off the screen, and whatever they held let go. */
  private takeDown(): void {
    this.controls?.destroy();
    this.controls = null;
    this.layer?.dispose();
    this.layer = null;
    const input = inputOf(this.world);
    input?.setAxis(MOVE_AXIS, ZERO);
    input?.setAxis(LOOK_AXIS, ZERO);
    input?.setVirtualKey(TOUCH_JUMP, false);
    input?.setVirtualKey(TOUCH_SPRINT, false);
  }
}

/** Each world's sticks, while a player controller holds them (D9's accessor). */
const sets = new WeakMap<World, TouchSet>();

/**
 * Holds `world`'s on-screen sticks until the result is disposed: the first hold
 * makes them, in `mode`, and the last release takes them down. A player
 * controller holds them from its start to its disposal, so a scene with none
 * shows none, as when each scene had its own engine.
 */
export function holdTouchControls(world: World, mode: TouchControlsMode): TouchHold {
  const set = sets.get(world) ?? new TouchSet(world, mode);
  sets.set(world, set);
  set.holds += 1;
  let released = false;
  return {
    get shown() {
      return !released && set.shown;
    },
    dispose() {
      if (released) return;
      released = true;
      set.holds -= 1;
      if (set.holds > 0) return;
      set.dispose();
      sets.delete(world);
    },
  };
}

/** How many holds `world`'s sticks have: 0 when it has none. For the tests. */
export function touchHolds(world: World): number {
  return sets.get(world)?.holds ?? 0;
}
