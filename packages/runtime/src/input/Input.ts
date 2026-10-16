import type { TouchControlsMode } from '@three-studio/core';
import { PressedKeys } from './PressedKeys';
import { TouchControls } from './TouchControls';
import { ZERO, shouldShowTouch, type Vec2 } from './touchMath';

/** The virtual keys the on-screen controls press. See `Input.virtual`. */
const TOUCH_JUMP = 'Space';
const TOUCH_SPRINT = 'ShiftLeft';

/**
 * The browser's own rate limit on pointer lock, which is not an error.
 *
 * Chrome throws a `SecurityError` whose message is the only thing telling it
 * apart from a real refusal — a sandboxed frame, a missing user gesture — and
 * those are worth reporting. Matched on the name plus the wording rather than
 * on the wording alone, so an unrelated `SecurityError` still surfaces.
 */
function isPointerLockCooldown(cause: unknown): boolean {
  if (!(cause instanceof Error) || cause.name !== 'SecurityError') return false;
  return cause.message.includes('exited the lock');
}

/**
 * Keyboard, mouse and touch state for the running game.
 *
 * Separate from the editor's own input handling: the runtime ships in the web
 * export, where none of the editor exists.
 */
export class Input {
  private readonly pressed = new PressedKeys();
  private mouseX = 0;
  private mouseY = 0;
  private wheel = 0;

  /**
   * Keys the on-screen controls are holding down.
   *
   * Kept apart from `PressedKeys` on purpose, and it is not a stylistic
   * separation: `PressedKeys.reconcile` drops any modifier it holds that the
   * current event reports released, which is how it survives macOS withholding
   * `keyup` under Cmd. A virtual `ShiftLeft` put in there would be deleted by
   * the first real keystroke that arrived without Shift — a stick held down and
   * a keyboard in the same room is not a rare pairing on a hybrid machine. That
   * class models the physical keyboard; this set is not one.
   */
  private readonly virtual = new Set<string>();

  private touch: TouchControls | null = null;
  private touchMode: TouchControlsMode = 'never';
  private touchZone: HTMLElement | null = null;
  /** A build already in flight, so a flurry of touches makes one overlay. */
  private touchBuilding = false;
  private sawTouch = false;
  private sawMouse = false;
  private disposed = false;

  constructor(private readonly domElement: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    // On the window rather than the canvas, which is what lets the tap on an
    // exported build's Start button be the one that summons the controls —
    // they are then already there when the game begins rather than costing a
    // first, wasted touch.
    window.addEventListener('pointerdown', this.onAnyPointerDown, true);
    window.addEventListener('pointermove', this.onAnyPointerMove, true);
    document.addEventListener('visibilitychange', this.onBlur);
    domElement.addEventListener('pointerdown', this.onPointerDown);
    domElement.addEventListener('pointermove', this.onPointerMove);
    domElement.addEventListener('wheel', this.onWheel, { passive: false });
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('pointerdown', this.onAnyPointerDown, true);
    window.removeEventListener('pointermove', this.onAnyPointerMove, true);
    document.removeEventListener('visibilitychange', this.onBlur);
    this.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.domElement.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.releasePointer();
    this.pressed.clear();
    this.virtual.clear();
    this.touch?.destroy();
    this.touch = null;
  }

  /**
   * Asks for on-screen controls, at the behest of whatever needs them.
   *
   * Called by `PlayerController` rather than by `Engine`, because the sticks
   * belong to the thing being driven: a scene with no player controller in it
   * shows none, and nobody had to write a rule saying so.
   *
   * **Idempotent.** Two player controllers in one scene are two callers, and
   * two sets of joysticks would be two sets of touch handlers fighting over the
   * same thumbs. The first caller's settings win.
   *
   * @param zone Where to draw them. Normally the canvas's parent.
   */
  enableTouch(mode: TouchControlsMode, zone: HTMLElement | null): void {
    if (this.touchZone !== null || this.disposed) return;
    this.touchMode = mode;
    this.touchZone = zone ?? this.domElement.parentElement;
    this.syncTouch();
  }

  /** Whether the on-screen controls are up — and therefore driving the view. */
  get touchActive(): boolean {
    return this.touch !== null;
  }

  /**
   * The move stick, as a vector whose **length is the throttle**.
   *
   * Zero when there are no controls, which is what lets the caller add this to
   * the keyboard's answer without asking whether touch exists.
   */
  moveAxis(): Vec2 {
    return this.touch?.move ?? ZERO;
  }

  /** The look stick's deflection, −1..1 per axis. A rate, not a displacement. */
  lookAxis(): Vec2 {
    return this.touch?.look ?? ZERO;
  }

  /**
   * `KeyboardEvent.code`: physical position, so WASD stays WASD on AZERTY.
   *
   * The on-screen buttons answer here too, which is what makes touch free for
   * everything that already asks a question about a key — the jump, the sprint,
   * and any user script reading `input.isDown('Space')`.
   */
  isDown(code: string): boolean {
    return this.pressed.has(code) || this.virtual.has(code);
  }

  isAnyDown(...codes: readonly string[]): boolean {
    return this.pressed.anyDown(codes) || codes.some((code) => this.virtual.has(code));
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.domElement;
  }

  /**
   * Mouse movement since the last call, in pixels. Reading clears it, so a
   * frame that does not read does not accumulate a jump for the next one.
   */
  consumeMouseDelta(): { x: number; y: number } {
    const delta = { x: this.mouseX, y: this.mouseY };
    this.mouseX = 0;
    this.mouseY = 0;
    return delta;
  }

  consumeWheel(): number {
    const value = this.wheel;
    this.wheel = 0;
    return value;
  }

  releasePointer(): void {
    if (this.pointerLocked) document.exitPointerLock();
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    this.pressed.down(event);
    // Space and the arrows scroll the page otherwise, which is visible as the
    // whole canvas jumping while the player jumps.
    if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.pressed.up(event);
  };

  /**
   * Losing focus mid-key would leave the player running forever — and mid-touch
   * is worse, because a finger lifted while the page is hidden sends no event
   * at all: an incoming call would leave the character walking into a wall
   * until somebody came back and nudged the stick.
   */
  private readonly onBlur = () => {
    this.pressed.clear();
    this.virtual.clear();
    this.touch?.release();
  };

  private readonly onPointerDown = (event: PointerEvent) => {
    if (this.pointerLocked) return;

    /*
     * Not for a finger, and not where the API is absent.
     *
     * Mobile Safari has no pointer lock at all, and the ones that do refuse it
     * for touch. Asking anyway printed `[input] pointer lock was refused` on
     * **every single tap** — a console full of red for a build that was working
     * perfectly, which is the fastest way to teach somebody that the console is
     * not worth reading.
     */
    if (event.pointerType === 'touch') return;
    if (typeof this.domElement.requestPointerLock !== 'function') return;

    // Mouse look needs unbounded travel, and the browser only grants the lock
    // in response to a gesture. A rejection is reported rather than swallowed:
    // without the lock there is no `movementX`, so the camera simply never
    // turns and nothing else hints at why.
    void Promise.resolve(this.domElement.requestPointerLock()).catch((cause: unknown) => {
      // Except the one rejection that is not a fault. Browsers refuse a lock
      // for about a second after the user has left one, so pressing Escape and
      // clicking straight back in always lands here — and the next click, past
      // the cooldown, works. Reporting it painted a red line in the Console for
      // ordinary play, which teaches people to ignore the panel.
      if (isPointerLockCooldown(cause)) return;
      console.error('[input] pointer lock was refused, so mouse look is disabled:', cause);
    });
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    if (!this.pointerLocked) return;
    this.mouseX += event.movementX;
    this.mouseY += event.movementY;
  };

  private readonly onWheel = (event: WheelEvent) => {
    event.preventDefault();
    this.wheel += event.deltaY;
  };

  private readonly onPointerLockChange = () => {
    if (!this.pointerLocked) this.pressed.clear();
  };

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
    this.syncTouch();
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
    this.syncTouch();
  };

  /** Builds or tears down the overlay to match what is currently true. */
  private syncTouch(): void {
    const zone = this.touchZone;
    if (zone === null || this.disposed) return;

    const wanted = shouldShowTouch(this.touchMode, this.sawTouch, this.sawMouse);
    if (!wanted) {
      this.virtual.clear();
      this.touch?.destroy();
      this.touch = null;
      return;
    }
    if (this.touch !== null || this.touchBuilding) return;

    this.touchBuilding = true;
    void TouchControls.create({
      zone,
      onJump: (down) => this.setVirtual(TOUCH_JUMP, down),
      onSprint: (down) => this.setVirtual(TOUCH_SPRINT, down),
    })
      .then((controls) => {
        // The import is a round trip, and a lot can happen across one: the
        // engine can be torn down, or a mouse can arrive and settle the
        // question the other way. Either way what just finished building is
        // already unwanted.
        if (controls === null) return;
        if (this.disposed || !shouldShowTouch(this.touchMode, this.sawTouch, this.sawMouse)) {
          controls.destroy();
          return;
        }
        this.touch = controls;
      })
      .catch((cause: unknown) => {
        console.error('[input] the on-screen controls could not be built:', cause);
      })
      .finally(() => {
        this.touchBuilding = false;
      });
  }

  private setVirtual(code: string, down: boolean): void {
    if (down) this.virtual.add(code);
    else this.virtual.delete(code);
  }
}
