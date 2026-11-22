import { PressedKeys } from './PressedKeys';
import { VirtualControls, type Vec2 } from './VirtualControls';

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

/** How the host wants `Input` to listen. */
export interface InputOptions {
  /**
   * Where keys are heard. `'window'`, the default and the exported player's
   * choice: every key the page receives. `'element'`: only while `domElement`
   * holds the focus — the editor's choice, so that a key typed in a panel never
   * reaches the game.
   */
  keys?: 'window' | 'element';
}

/**
 * Keyboard and mouse state for the running game, and the virtual axes and keys
 * that on-screen controls set (`setAxis`, `setVirtualKey`): the sticks are a
 * screen layer of the player controllers, and `Input` names none of them.
 *
 * Separate from the editor's own input handling: the runtime ships in the web
 * export, where none of the editor exists.
 *
 * Keys are heard window-wide unless the host asks otherwise. In the exported
 * player the page is the game, so every key is its own. The editor shares its
 * page with a Console, an Inspector and a palette, and there a space typed in a
 * field made the player jump and never reached the field; it asks for the keys
 * typed into the canvas alone.
 */
export class Input {
  private readonly pressed = new PressedKeys();
  private mouseX = 0;
  private mouseY = 0;
  private wheel = 0;

  /** What on-screen controls hold: apart from `PressedKeys`, for the reason `VirtualControls` gives. */
  private readonly virtual = new VirtualControls();
  /** Keys are heard on `domElement` alone: see `InputOptions.keys`. */
  private readonly keysOnElement: boolean;

  constructor(
    private readonly domElement: HTMLElement,
    options: InputOptions = {},
  ) {
    this.keysOnElement = options.keys === 'element';
    if (this.keysOnElement) {
      domElement.addEventListener('keydown', this.onKeyDown);
      domElement.addEventListener('keyup', this.onKeyUp);
      domElement.addEventListener('blur', this.onBlur);
    } else {
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('keyup', this.onKeyUp);
    }
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onBlur);
    domElement.addEventListener('pointerdown', this.onPointerDown);
    domElement.addEventListener('pointermove', this.onPointerMove);
    domElement.addEventListener('wheel', this.onWheel, { passive: false });
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  dispose(): void {
    if (this.keysOnElement) {
      this.domElement.removeEventListener('keydown', this.onKeyDown);
      this.domElement.removeEventListener('keyup', this.onKeyUp);
      this.domElement.removeEventListener('blur', this.onBlur);
    } else {
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
    }
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onBlur);
    this.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.domElement.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.releasePointer();
    this.pressed.clear();
    this.virtual.clear();
  }

  /**
   * A virtual axis, by the name its setter gave it — `move` and `look` for the
   * sticks —, as a vector whose length is the throttle: `ZERO` when nothing set
   * it, which is what lets a reader add it to the keyboard's answer without
   * asking whether touch exists.
   */
  axis(name: string): Readonly<Vec2> {
    return this.virtual.axis(name);
  }

  setAxis(name: string, value: Readonly<Vec2>): void {
    this.virtual.setAxis(name, value);
  }

  /** Presses or releases a key no keyboard holds: an on-screen button's. `isDown` answers for it. */
  setVirtualKey(code: string, down: boolean): void {
    this.virtual.setKey(code, down);
  }

  /**
   * `KeyboardEvent.code`: physical position, so WASD stays WASD on AZERTY.
   *
   * The on-screen buttons answer here too, which is what makes touch free for
   * everything that already asks a question about a key — the jump, the sprint,
   * and any user script reading `input.isDown('Space')`.
   */
  isDown(code: string): boolean {
    return this.pressed.has(code) || this.virtual.isDown(code);
  }

  isAnyDown(...codes: readonly string[]): boolean {
    return this.anyDown(codes);
  }

  /**
   * `isAnyDown` for a caller that keeps its list of codes: no rest array and
   * no callback per call, which a player controller asks several times a tick.
   */
  anyDown(codes: readonly string[]): boolean {
    if (this.pressed.anyDown(codes)) return true;
    for (let i = 0; i < codes.length; i += 1) {
      const code = codes[i];
      if (code !== undefined && this.virtual.isDown(code)) return true;
    }
    return false;
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.domElement;
  }

  /**
   * Mouse movement since the last call, in pixels, written into `target`,
   * which comes back. Reading clears it, so a frame that does not read does
   * not accumulate a jump for the next one. Into a target the caller keeps, so
   * a script reading it every frame makes nothing.
   */
  consumeMouseDelta<T extends { x: number; y: number }>(target: T): T {
    target.x = this.mouseX;
    target.y = this.mouseY;
    this.mouseX = 0;
    this.mouseY = 0;
    return target;
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
    // whole canvas jumping while the player jumps. Only for a key the game
    // hears: on the element, a space typed in one of the editor's fields is the
    // field's again, and so is its caret.
    if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
    // Tab moves the focus on, and a game that hears keys on its element alone
    // goes deaf the moment it loses the focus — at the first press of a
    // scoreboard on Tab. Window-wide, the keys stay the game's wherever the
    // focus goes, so the exported player leaves Tab to the page, as it always has.
    else if (event.code === 'Tab' && this.keysOnElement) event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.pressed.up(event);
  };

  /**
   * Losing focus mid-key would leave the player running forever — and mid-touch
   * is worse, because a finger lifted while the page is hidden sends no event
   * at all: an incoming call would leave the character walking into a wall
   * until somebody came back and nudged the stick.
   *
   * With keys heard on the element, the focus leaving it is the same moment: a
   * W held while clicking into one of the editor's panels is released where
   * the game no longer listens.
   */
  private readonly onBlur = () => {
    this.pressed.clear();
    this.virtual.clear();
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
}
