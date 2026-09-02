/**
 * What `PressedKeys` needs from a `KeyboardEvent`.
 *
 * Structurally typed, like `hasModifier` in the editor, so the class can be
 * driven — and tested — without a DOM.
 */
export interface KeyEventLike {
  readonly code: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * The modifier `code`s we may hold, each paired with the event flag that says
 * whether it is really down. Every key event carries all four, so any event is
 * an opportunity to correct a modifier we are wrong about.
 */
const MODIFIER_FLAGS: Readonly<Record<string, keyof KeyEventLike>> = {
  AltLeft: 'altKey',
  AltRight: 'altKey',
  ControlLeft: 'ctrlKey',
  ControlRight: 'ctrlKey',
  MetaLeft: 'metaKey',
  MetaRight: 'metaKey',
  ShiftLeft: 'shiftKey',
  ShiftRight: 'shiftKey',
};

/**
 * The set of physically held keys, as far as the page can tell.
 *
 * A `keyup` is not guaranteed. macOS withholds it for every ordinary key while
 * Cmd is down, so `⌘S` over a 3D view used to leave `KeyS` held forever: the
 * camera then flew backwards on its own and W appeared to reverse. The set is
 * therefore treated as a guess that must be corrected, not as a record:
 *
 * - a chord is a command, not movement, so it records nothing and drops what
 *   was held — the press whose release will never arrive never gets in;
 * - every event re-checks the modifiers it reports against the ones we hold.
 *
 * Owners are still expected to `clear()` on the transitions they control —
 * losing focus, losing the pointer lock, ending a gesture. This class only
 * makes those safety nets unnecessary rather than load-bearing.
 */
export class PressedKeys {
  private readonly held = new Set<string>();

  down(event: KeyEventLike): void {
    this.reconcile(event);

    if (event.metaKey || event.ctrlKey) {
      this.clear();
      return;
    }

    this.held.add(event.code);
  }

  up(event: KeyEventLike): void {
    this.held.delete(event.code);
    this.reconcile(event);
  }

  /** `KeyboardEvent.code`: physical position, so WASD stays WASD on AZERTY. */
  has(code: string): boolean {
    return this.held.has(code);
  }

  anyDown(codes: readonly string[]): boolean {
    return codes.some((code) => this.held.has(code));
  }

  clear(): void {
    this.held.clear();
  }

  get size(): number {
    return this.held.size;
  }

  /** Drop every modifier we hold that this event reports as released. */
  private reconcile(event: KeyEventLike): void {
    for (const code of this.held) {
      const flag = MODIFIER_FLAGS[code];
      if (flag !== undefined && event[flag] !== true) this.held.delete(code);
    }
  }
}
