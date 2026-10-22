import { ZERO, isSprintForce, stickToMove, type Vec2 } from './touchMath';

/**
 * What `nipplejs.create` hands back.
 *
 * Derived rather than imported, because the package declares `Collection` and
 * does not export it — and a type-only `import()` is erased, so naming it this
 * way costs nothing at runtime, which is the whole point below.
 */
type Collection = ReturnType<typeof import('nipplejs').create>;

/*
 * The on-screen sticks, and the only place in this package that builds DOM.
 *
 * That is worth defending rather than apologising for. The editor's play mode
 * and an exported build have to offer the same controls, or the thing being
 * tested is not the thing being shipped — the same argument that makes
 * `rendering.batching` a project setting rather than a per-view flag. Both
 * hosts hand the engine a canvas and nothing else, so putting this on the host
 * side would be two implementations, and two implementations of an input scheme
 * are two different feels.
 *
 * **nipplejs is imported dynamically, and it has to be.** It builds a singleton
 * factory while the module is being evaluated, and that constructor binds
 * `resize` and `scroll` on `window` — so a static import throws
 * `ReferenceError: window is not defined` the moment anything pulls `Input`
 * into a Node test. The deferral is not a size optimisation, though it is one
 * as well: the ~10 kB only travels once somebody has actually touched the
 * screen, and a desktop build never asks. That is the distinction
 * `RendererFactory` draws where it *refuses* to defer its light tables — those
 * are awaited on every single start, and this is not.
 */

/** How much of the screen each stick answers to, measured from the bottom. */
const ZONE_WIDTH = '45%';
const ZONE_HEIGHT = '55%';
const STICK_SIZE = 110;

/** `env()` with a fallback: without one the whole declaration is dropped. */
const safe = (side: string, extra = '0px'): string =>
  `calc(${extra} + env(safe-area-inset-${side}, 0px))`;

/**
 * Written through `setProperty` rather than onto `style`, so a vendor property
 * is a string like any other: `-webkit-tap-highlight-color` has no camel-cased
 * member to assign to at all.
 */
function style(element: HTMLElement, rules: Readonly<Record<string, string>>): void {
  for (const [property, value] of Object.entries(rules)) element.style.setProperty(property, value);
}

export interface TouchControlsOptions {
  /**
   * Where the controls are drawn. Normally the canvas's parent.
   *
   * The overlay is `position: absolute; inset: 0`, so it resolves against the
   * nearest positioned ancestor — the game's host on the Viewport's stage in the
   * editor, and the viewport in an exported build, whose `<body>` is not
   * positioned. Both land where they should without this package touching a
   * host's styles.
   */
  zone: HTMLElement;
  /** Presses and releases the virtual `Space`. */
  onJump: (down: boolean) => void;
  /** Presses and releases the virtual `ShiftLeft`. */
  onSprint: (down: boolean) => void;
}

export class TouchControls {
  /** Throttle-carrying: its length is the fraction of `moveSpeed` asked for. */
  move: Vec2 = ZERO;
  /** Deflection of the look stick, −1..1 per axis. A rate, not a delta. */
  look: Vec2 = ZERO;

  private destroyed = false;

  private constructor(
    private readonly root: HTMLElement,
    private readonly sticks: readonly Collection[],
    private readonly onReposition: () => void,
  ) {}

  /**
   * Builds the overlay, or `null` where there is no document to build it in.
   *
   * Asynchronous because of the import, and the caller does not wait for it:
   * the touch that asks for the controls is spent summoning them either way.
   */
  static async create(options: TouchControlsOptions): Promise<TouchControls | null> {
    if (typeof document === 'undefined') return null;
    const nipple = await import('nipplejs');

    const root = document.createElement('div');
    root.dataset['studioTouch'] = '';
    // `pointer-events: none` here and `auto` on what it holds, so the screen
    // between the sticks still reaches the canvas.
    style(root, {
      position: 'absolute',
      inset: '0',
      'pointer-events': 'none',
      'touch-action': 'none',
      'user-select': 'none',
      '-webkit-user-select': 'none',
      'z-index': '10',
    });

    const moveZone = zoneElement({ left: safe('left') });
    const lookZone = zoneElement({ right: safe('right') });
    const jump = jumpButton();
    // The button last, so it paints over the look zone it overlaps.
    root.append(moveZone, lookZone, jump);
    // Before the sticks: nipplejs measures its zone as it is created, and a
    // zone that is not in the document yet has no box to measure.
    options.zone.append(root);

    /*
     * `static` for movement and `semi` for looking, which is not a matter of
     * taste.
     *
     * A `static` stick stays where it was put, so a thumb finds it without the
     * eyes leaving the game — and a touch anywhere in its zone deflects it from
     * that fixed centre, which for walking reads as "lean that way".
     *
     * Doing the same to the look stick would snap the camera to full deflection
     * wherever the thumb happened to land. `semi` creates the stick *under* the
     * thumb and keeps it there, which is what every mobile shooter does and the
     * only arrangement in which aiming is not a fight.
     */
    const moveStick = nipple.create({
      zone: moveZone,
      mode: 'static',
      position: { left: `${STICK_SIZE * 0.8}px`, bottom: `${STICK_SIZE * 0.8}px` },
      size: STICK_SIZE,
      color: 'white',
      restOpacity: 0.4,
    });

    const lookStick = nipple.create({
      zone: lookZone,
      mode: 'semi',
      size: STICK_SIZE,
      color: 'white',
      restOpacity: 0.4,
    });

    /*
     * nipplejs watches its own zone with a `ResizeObserver`, which covers the
     * panel being resized. What that cannot see is the zone *moving* without
     * changing size — a dock tab dragged to the other half of the window, or a
     * phone turned while the layout keeps its proportions.
     *
     * `reposition()` rather than `dynamicPage: true`: the library's own note on
     * that option is that it "has a significant performance cost", because it
     * re-measures on every move event. This re-measures twice per rotation.
     */
    const onReposition = () => {
      moveStick.reposition();
      lookStick.reposition();
    };
    window.addEventListener('resize', onReposition);
    window.addEventListener('orientationchange', onReposition);

    const controls = new TouchControls(root, [moveStick, lookStick], onReposition);

    moveStick.on('move', (event) => {
      controls.move = stickToMove(event.data.vector);
      options.onSprint(isSprintForce(event.data.force));
    });
    moveStick.on('end', () => {
      controls.move = ZERO;
      options.onSprint(false);
    });

    lookStick.on('move', (event) => {
      // The same dead zone: a thumb resting on the look stick would otherwise
      // turn the camera for as long as it stayed there.
      controls.look = stickToMove(event.data.vector);
    });
    lookStick.on('end', () => {
      controls.look = ZERO;
    });

    // `pointerdown` rather than `click`: a jump has to start when the thumb
    // lands, not when it lifts. `preventDefault` is what stops the browser
    // following up with a synthetic mouse event and a focus ring.
    jump.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      options.onJump(true);
    });
    // Every way a press can stop, including a thumb that slid off the button.
    for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
      jump.addEventListener(type, () => options.onJump(false));
    }

    return controls;
  }

  /** Everything back to rest, for a page that went away mid-gesture. */
  release(): void {
    this.move = ZERO;
    this.look = ZERO;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    window.removeEventListener('resize', this.onReposition);
    window.removeEventListener('orientationchange', this.onReposition);
    for (const stick of this.sticks) stick.destroy();
    this.root.remove();
  }
}

function zoneElement(edge: Readonly<Record<string, string>>): HTMLElement {
  const zone = document.createElement('div');
  style(zone, {
    position: 'absolute',
    bottom: safe('bottom'),
    width: ZONE_WIDTH,
    height: ZONE_HEIGHT,
    'pointer-events': 'auto',
    'touch-action': 'none',
    ...edge,
  });
  return zone;
}

/**
 * The jump button.
 *
 * A **sibling** of the look zone rather than a child of it, and that is what
 * keeps the two apart: an event bubbles up its own ancestors and never
 * sideways, so a press landing here is never seen by the stick's handler — no
 * `stopPropagation`, and no ordering to get right.
 */
function jumpButton(): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '⤒';
  button.setAttribute('aria-label', 'Jump');
  style(button, {
    position: 'absolute',
    right: safe('right', '28px'),
    bottom: safe('bottom', `${STICK_SIZE * 1.5}px`),
    width: '72px',
    height: '72px',
    'border-radius': '50%',
    border: '2px solid rgba(255,255,255,0.55)',
    background: 'rgba(255,255,255,0.18)',
    color: 'rgba(255,255,255,0.85)',
    font: '26px/1 ui-sans-serif, system-ui, sans-serif',
    'pointer-events': 'auto',
    'touch-action': 'none',
    'user-select': 'none',
    '-webkit-user-select': 'none',
    '-webkit-tap-highlight-color': 'transparent',
  });
  return button;
}
