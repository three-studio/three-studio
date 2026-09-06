import type { Vec2, Vec3 } from './scene/primitives';

/**
 * One editable value, described without saying how it is drawn.
 *
 * The vocabulary a *declaration* is written in, as opposed to the binding the
 * inspector makes of it. It has two producers today and they had one of these
 * each: an importer says what a file format lets the author decide, and a
 * script says what a designer may set per instance. They were the same eight
 * ideas under two names, with an adapter each — a hundred lines on the script
 * side — and the two adapters had grown apart: the import rows had no defaults
 * and the script rows had no groups.
 *
 * Dependency-free on purpose, and that is not incidental to where it lives:
 * `core` cannot import Tweakpane, React or three, so a declaration written here
 * can be read by anything, including — the day it exists — a component type
 * that ships from outside this repo.
 *
 * The tags are the ones user scripts already write (`boolean`, not `toggle`),
 * because those are compiled against by code this repo does not own. See
 * `RUNTIME_DTS` in the desktop app, which prints them into every project.
 */
export type FieldDef =
  | { type: 'number'; default?: number; min?: number; max?: number; step?: number; label?: string }
  | { type: 'boolean'; default?: boolean; label?: string }
  | { type: 'string'; default?: string; label?: string }
  | { type: 'color'; default?: string; label?: string }
  /**
   * Two or three numbers the author edits as a pad.
   *
   * `min`, `max` and `step` apply to every axis, because every declaration
   * there has ever been sets them the same on each — a per-axis form is a
   * shape to invent the day one differs.
   */
  | { type: 'vec2'; default?: Vec2; min?: number; max?: number; step?: number; label?: string }
  | { type: 'vec3'; default?: Vec3; min?: number; max?: number; step?: number; label?: string }
  | { type: 'enum'; options: readonly FieldOption[]; default?: string; label?: string }
  /** An entity picked in the scene; a script receives a live handle. */
  | { type: 'entity'; label?: string }
  /** An asset picked in the project; a script receives its id. */
  | { type: 'asset'; kind?: string; label?: string };

/**
 * A choice, as either spelling.
 *
 * A bare string is value and label at once, which is what a script writes and
 * what reads well when the value is already a word. An importer needs the two
 * apart — `srgb` shows as "sRGB (colour)" — and scripts are welcome to it.
 * Normalise with `fieldOptions` rather than testing for the shape again.
 */
export type FieldOption = string | { value: string; label: string };

/** Value and label for each choice, whichever way they were written. */
export function fieldOptions(
  options: readonly FieldOption[],
): readonly { value: string; label: string }[] {
  return options.map((option) =>
    typeof option === 'string' ? { value: option, label: option } : option,
  );
}

/**
 * One row of a declared list, which is a field plus where it is stored.
 *
 * A script declares a `Record<string, FieldDef>` and gets its keys from the
 * record; anything declaring an ordered list carries the key on the row. Both
 * end up here, which is what lets one adapter serve them.
 */
export type FieldRow = (FieldDef & { key: string }) | FieldGroup | FieldAction;

/**
 * A titled block of rows.
 *
 * How a common trunk and a format's own settings stay apart on screen while
 * being one flat object underneath: `ModelImporter` contributes the "Model"
 * group and each subclass its own, and both write into the same settings.
 */
export interface FieldGroup {
  type: 'group';
  label: string;
  fields: readonly FieldRow[];
}

/**
 * A button rather than a value.
 *
 * `key` names the action; what it does belongs to whoever is showing the
 * fields, because it usually needs something the declaration does not have —
 * "Fit to 1 m" needs the bounding box, which only exists once the file is open.
 */
export interface FieldAction {
  type: 'action';
  key: string;
  /** The row's label column, and may be empty. */
  label: string;
  /** Text on the button. */
  title: string;
}

/**
 * Builders for the ordered form.
 *
 * Only the four an importer actually writes. The other four variants exist for
 * scripts, which declare object literals in a record and never reach for a
 * builder — a `field.entity()` with no caller would be a line to keep in step
 * with nothing.
 */
export const field = {
  group: (label: string, fields: readonly FieldRow[]): FieldGroup => ({
    type: 'group',
    label,
    fields,
  }),
  number: (
    key: string,
    label: string,
    params: { min?: number; max?: number; step?: number } = {},
  ): FieldRow => ({ type: 'number', key, label, ...params }),
  /** Named for what it draws; the tag stays `boolean`, which is what a script writes. */
  toggle: (key: string, label: string): FieldRow => ({ type: 'boolean', key, label }),
  enum: (key: string, label: string, options: readonly FieldOption[]): FieldRow => ({
    type: 'enum',
    key,
    label,
    options,
  }),
  action: (key: string, label: string, title: string): FieldAction => ({
    type: 'action',
    key,
    label,
    title,
  }),
};
