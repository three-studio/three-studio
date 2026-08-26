/**
 * What an importer says about the settings it accepts.
 *
 * Declarative and dependency-free on purpose: `core` cannot import Tweakpane,
 * React or three, and an importer that described its own controls would drag
 * one of the three in. The editor adapts this into `FieldSpec` — the same trick
 * `scriptFields` already plays on `ScriptPropertyDef`, which is where the shape
 * comes from.
 *
 * There is no `visibleWhen`: `AssetImporter.fields` is handed the current
 * settings, so a row that should not appear is simply not returned.
 */
export type ImportField =
  | ImportGroup
  | ImportNumber
  | ImportToggle
  | ImportEnum
  | ImportAction;

/**
 * A titled block of rows.
 *
 * How the common trunk and the format's own settings stay apart on screen while
 * being one flat object underneath: `ModelImporter` contributes the "Model"
 * group and each subclass its own, and both write into the same settings.
 */
export interface ImportGroup {
  type: 'group';
  label: string;
  fields: readonly ImportField[];
}

interface RowBase {
  /** Key in the settings object this row reads and writes. */
  key: string;
  label: string;
}

export interface ImportNumber extends RowBase {
  type: 'number';
  min?: number;
  max?: number;
  /** Drag feel rather than a grid; see `numeric()` in the editor. */
  step?: number;
}

export interface ImportToggle extends RowBase {
  type: 'toggle';
}

export interface ImportEnum extends RowBase {
  type: 'enum';
  options: readonly ImportOption[];
}

export interface ImportOption {
  value: string;
  label: string;
}

/**
 * A button rather than a value.
 *
 * `key` names the action; what it does belongs to whoever is showing the
 * fields, because it usually needs something the importer does not have — "Fit
 * to 1 m" needs the bounding box, which only exists once the file is open.
 */
export interface ImportAction extends RowBase {
  type: 'action';
  /** Text on the button. `label` is the row's label column, and may be empty. */
  title: string;
}

export const field = {
  group: (label: string, fields: readonly ImportField[]): ImportGroup => ({
    type: 'group',
    label,
    fields,
  }),
  number: (
    key: string,
    label: string,
    params: { min?: number; max?: number; step?: number } = {},
  ): ImportNumber => ({ type: 'number', key, label, ...params }),
  toggle: (key: string, label: string): ImportToggle => ({ type: 'toggle', key, label }),
  enum: (key: string, label: string, options: readonly ImportOption[]): ImportEnum => ({
    type: 'enum',
    key,
    label,
    options,
  }),
  action: (key: string, label: string, title: string): ImportAction => ({
    type: 'action',
    key,
    label,
    title,
  }),
};
