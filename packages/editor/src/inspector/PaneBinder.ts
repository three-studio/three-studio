import { Pane, type FolderApi } from 'tweakpane';
import { assetFieldBundle } from './assetField';
import type { BoundSpec } from './schema';

/** Tweakpane binds to mutable plain objects, so each field gets its own. */
export interface Holder {
  value: unknown;
}

/** A control and the way to pull its value back out of the source of truth. */
export interface BoundField {
  holder: Holder;
  read: () => unknown;
}

/**
 * How one bound row reaches its value.
 *
 * The only thing that differs between an entity pane, the scene pane and the
 * import dialog's settings pane: same controls, same coalescing, same refresh,
 * different reader and writer.
 */
export interface FieldIO {
  read: () => unknown;
  /**
   * @param last True on the last event of a gesture — a slider released, a
   *   text field blurred.
   * @param generation Bumped when a gesture ends; part of the coalesce key, so
   *   one drag is one undo entry and the next drag is another.
   */
  write: (value: unknown, context: { last: boolean; generation: number }) => void;
}

/**
 * A Tweakpane pane and the rows bound to it, kept in step with a source of
 * truth that is not the pane.
 *
 * It owns the three pieces of state that every such pane needs and that are
 * easy to get wrong: which rows to re-read on `refresh()`, whether a `change`
 * event is the user or the refresh talking back, and the gesture counter the
 * coalescing keys are built from.
 */
export class PaneBinder {
  readonly pane: Pane;
  private readonly fields: BoundField[] = [];
  /** Bumped when a gesture ends so the next one opens a new undo entry. */
  private gestures = 0;
  /** True while a change originates from this pane, to suppress self-refresh. */
  private writing = false;
  /** True while pulling values in from the source; see `edit`. */
  private pulling = false;
  /**
   * True once the pane is gone, and the reason this flag exists at all.
   *
   * `pane.dispose()` takes the DOM away; it does **not** take away the listeners
   * Tweakpane put on the *document* when a drag started — those live until the
   * mouse comes back up (`@tweakpane/core` `pointer-handler.js:52`). So a pane
   * disposed mid-drag goes on receiving `mousemove` and `mouseup`, computes a
   * position against an element that is no longer in the layout, and writes what
   * it finds there into the document.
   *
   * What it finds there is `NaN`: `getBoundingClientRect()` on a detached
   * element is all zeros, and the slider maps the pointer with
   * `mapRange(x, 0, width, min, max)`, which is `0 / 0` when the width is zero.
   */
  private disposed = false;

  constructor(container: HTMLElement) {
    this.pane = new Pane({ container });
    this.pane.registerPlugin(assetFieldBundle);
  }

  /** True while `refresh()` is running: a change now is the source talking back. */
  get refreshing(): boolean {
    return this.pulling;
  }

  get generation(): number {
    return this.gestures;
  }

  endGesture(): void {
    this.gestures += 1;
  }

  /** Registers a hand-rolled binding so `refresh()` re-reads it too. */
  track(holder: Holder, read: () => unknown): void {
    this.fields.push({ holder, read });
  }

  /** One control, wired to whatever `io` says its value is. */
  bind(folder: FolderApi | Pane, spec: BoundSpec, io: FieldIO): void {
    const read = () => {
      const raw = io.read();
      return spec.toModel ? spec.toModel(raw) : raw;
    };

    // A field whose value is missing must cost that field, not the panel.
    // Tweakpane has no control for `undefined` and throws "No matching
    // controller", which the error boundary turns into a blank Inspector; and a
    // converter reading a shape that is not there throws before that even. Data
    // written before a property existed is migrated on load — this is the belt
    // to those braces.
    let initial: unknown;
    try {
      initial = read();
    } catch (cause) {
      console.warn(`[inspector] could not read ${spec.path.join('.')}; field skipped.`, cause);
      return;
    }
    if (initial === undefined) {
      console.warn(`[inspector] no value at ${spec.path.join('.')}; field skipped.`);
      return;
    }

    const holder: Holder = { value: initial };

    // Computed at build time so a dropdown lists the scripts, entities or
    // assets that exist right now, not whatever existed when the schema loaded.
    const dynamicOptions = spec.optionsProvider?.();
    const params = {
      label: spec.label,
      ...numeric(spec.params),
      ...(dynamicOptions ? { options: dynamicOptions } : {}),
    };

    folder.addBinding(holder, 'value', params).on('change', (event) => {
      // A change raised by `refresh()` is the source talking back, not the
      // user; acting on it would also bump the coalescing generation.
      if (this.pulling) return;
      // A pane that has been taken down has nothing left to say. See `disposed`.
      if (this.disposed) return;

      const value = spec.fromModel ? spec.fromModel(event.value) : event.value;
      // Belt to the brace above, and a rule worth stating on its own: no field
      // in this editor has a use for `NaN` or an infinity. A number that is not
      // one is a control that has lost its footing — a detached slider, a text
      // field mid-edit — and writing it would put a value in the document that
      // every later comparison answers `false` to, silently.
      if (typeof value === 'number' && !Number.isFinite(value)) return;
      io.write(value, { last: event.last, generation: this.gestures });
      if (event.last) this.gestures += 1;
    });

    this.track(holder, read);
  }

  /**
   * Runs an edit that came from the user touching a control.
   *
   * Tweakpane's `refresh()` re-reads the bound object and emits `change`
   * whenever the value moved, so a gizmo drag bounces back through here as a
   * second edit carrying the inspector's coalesce key. The two keys then
   * alternate, coalescing never matches, and a single drag leaves one undo
   * entry per frame. Ignoring changes raised during a refresh is what keeps a
   * drag a single step.
   */
  edit(action: () => void): void {
    if (this.pulling) return;
    this.writing = true;
    try {
      action();
    } finally {
      this.writing = false;
    }
  }

  refresh(): void {
    if (this.writing) return;
    this.pulling = true;
    try {
      for (const field of this.fields) field.holder.value = field.read();
      this.pane.refresh();
    } finally {
      this.pulling = false;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.pane.dispose();
  }
}

/**
 * Turns a declared `step` into drag feel rather than a grid values snap to.
 *
 * Tweakpane's `step` quantises *everything*, including what you type: with the
 * tiling field's `step: 0.1`, typing 0.025 stored -5.5e-17 and showed "-0.0";
 * with the offset field's 0.01 it became 0.03. A step is a statement about how
 * fast a drag should move, not about which values are allowed to exist.
 *
 * So a fractional step becomes `pointerScale` — the same number, now units per
 * pixel of drag — and the field accepts whatever is typed. A whole step is left
 * alone, because a field like "segments" really does only take integers.
 *
 * The default display rounds to two decimals, which would show a stored 0.025
 * as "0.03" and make a correct value look wrong. `format` widens it to the
 * precision the step implies, without trailing zeros.
 */
export function numeric(params: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!params) return {};

  // `x` and `y` blocks of a point2d carry their own step, so they recurse.
  const axes: Record<string, unknown> = {};
  for (const axis of ['x', 'y', 'z'] as const) {
    const declared = params[axis];
    if (declared && typeof declared === 'object') {
      axes[axis] = numeric(declared as Record<string, unknown>);
    }
  }

  const step = params['step'];
  if (typeof step !== 'number' || Number.isInteger(step)) {
    return { ...params, ...axes };
  }

  const { step: _dropped, ...rest } = params;
  return { ...rest, ...axes, pointerScale: step, format: decimalsFor(step) };
}

/** Shows as many decimals as the step implies, and no trailing zeros. */
function decimalsFor(step: number): (value: number) => string {
  // One digit finer than the step, so a value nudged off the grid still reads
  // as itself rather than as its neighbour.
  const digits = Math.min(6, Math.max(2, Math.ceil(-Math.log10(step)) + 1));
  return (value: number) => {
    const text = value.toFixed(digits);
    return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
  };
}
