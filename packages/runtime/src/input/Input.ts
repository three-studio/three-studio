import { PressedKeys } from './PressedKeys';

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
 * Keyboard and mouse state for the running game.
 *
 * Separate from the editor's own input handling: the runtime ships in the web
 * export, where none of the editor exists.
 */
export class Input {
  private readonly pressed = new PressedKeys();
  private mouseX = 0;
  private mouseY = 0;
  private wheel = 0;

  constructor(private readonly domElement: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    domElement.addEventListener('pointerdown', this.onPointerDown);
    domElement.addEventListener('pointermove', this.onPointerMove);
    domElement.addEventListener('wheel', this.onWheel, { passive: false });
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.domElement.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.releasePointer();
    this.pressed.clear();
  }

  /** `KeyboardEvent.code`: physical position, so WASD stays WASD on AZERTY. */
  isDown(code: string): boolean {
    return this.pressed.has(code);
  }

  isAnyDown(...codes: readonly string[]): boolean {
    return this.pressed.anyDown(codes);
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

  /** Losing focus mid-key would leave the player running forever. */
  private readonly onBlur = () => {
    this.pressed.clear();
  };

  private readonly onPointerDown = () => {
    if (this.pointerLocked) return;

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
