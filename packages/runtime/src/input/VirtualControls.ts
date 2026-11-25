export interface Vec2 {
  x: number;
  y: number;
}

export const ZERO: Readonly<Vec2> = { x: 0, y: 0 };

/**
 * Axes and keys something other than the keyboard and the mouse holds: the
 * on-screen sticks today, a gamepad or a UI's buttons next. Each names what it
 * sets, and whoever reads asks by that name, so `Input` knows no stick.
 *
 * Virtual keys are kept apart from `PressedKeys` on purpose, and it is not a
 * stylistic separation: `PressedKeys.reconcile` drops any modifier it holds
 * that the current event reports released, which is how it survives macOS
 * withholding `keyup` under Cmd. A virtual `ShiftLeft` put in there would be
 * deleted by the first real keystroke that arrived without Shift — a stick
 * held down and a keyboard in the same room is not a rare pairing on a hybrid
 * machine. That class models the physical keyboard; this one does not.
 */
export class VirtualControls {
  private readonly axes = new Map<string, Readonly<Vec2>>();
  private readonly keys = new Set<string>();

  /** `ZERO` when nothing set it, so a reader adds it to the keyboard's answer without asking. */
  axis(name: string): Readonly<Vec2> {
    return this.axes.get(name) ?? ZERO;
  }

  setAxis(name: string, value: Readonly<Vec2>): void {
    this.axes.set(name, value);
  }

  setKey(code: string, down: boolean): void {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** Everything back to rest: a finger lifted while the page is hidden sends no event at all. */
  clear(): void {
    this.axes.clear();
    this.keys.clear();
  }
}
