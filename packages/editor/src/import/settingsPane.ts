import type { AssetSettings, ImportField } from '@three-studio/core';
import type { FolderApi } from 'tweakpane';
import { PaneBinder } from '../inspector/PaneBinder';
import type { BoundSpec } from '../inspector/schema';

/** What a button in the settings pane asks the dialog to do. */
export type ImportActionHandler = (key: string) => void;

/**
 * Renders an importer's declared fields, and writes back what is edited.
 *
 * The adapter between `core`'s `ImportField` — which knows nothing of any UI
 * toolkit, because `core` depends on nothing — and the Tweakpane rows the
 * inspector already uses. `scriptFields` does the same for a script's declared
 * properties; this is that trick applied to a file format.
 *
 * The settings object is mutated in place and `onChange` is told, so the caller
 * decides what a change means: for the import dialog it is a draft to keep, and
 * for a live preview it is a reason to redraw.
 */
export class ImportSettingsPane {
  private readonly binder: PaneBinder;

  constructor(
    container: HTMLElement,
    fields: readonly ImportField[],
    private settings: Record<string, unknown>,
    private readonly onChange: (settings: Record<string, unknown>) => void,
    private readonly onAction: ImportActionHandler,
  ) {
    this.binder = new PaneBinder(container);
    this.build(this.binder.pane, fields);
  }

  /** Pulls new values in without rebuilding, after "Fit to 1 m" or "Reset". */
  adopt(settings: Record<string, unknown>): void {
    this.settings = settings;
    this.binder.refresh();
  }

  dispose(): void {
    this.binder.dispose();
  }

  private build(parent: FolderApi | PaneBinder['pane'], fields: readonly ImportField[]): void {
    for (const field of fields) {
      if (field.type === 'group') {
        // Expanded: a group is a heading here, not a drawer. There are two of
        // them at most, and a collapsed one reads as "nothing to set".
        const folder = parent.addFolder({ title: field.label, expanded: true });
        this.build(folder, field.fields);
        continue;
      }

      if (field.type === 'action') {
        parent
          .addButton({ title: field.title, label: field.label })
          .on('click', () => this.onAction(field.key));
        continue;
      }

      this.binder.bind(parent as FolderApi, specFor(field), {
        read: () => this.settings[field.key],
        write: (value) => {
          this.settings = { ...this.settings, [field.key]: value };
          this.onChange(this.settings);
        },
      });
    }
  }
}

/** One declared row, in the shape the inspector's binder already speaks. */
function specFor(field: Exclude<ImportField, { type: 'group' } | { type: 'action' }>): BoundSpec {
  const base = { path: [field.key], label: field.label };

  switch (field.type) {
    case 'number':
      // Tweakpane infers the widget from the value, and narrows it with these.
      return { ...base, params: { min: field.min, max: field.max, step: field.step } };
    case 'enum':
      // Tweakpane wants label -> value, which is the reverse of how a format
      // declares its options.
      return {
        ...base,
        params: {
          options: Object.fromEntries(field.options.map((o) => [o.label, o.value])),
        },
      };
    case 'toggle':
      // No params at all: a boolean is already a checkbox.
      return base;
  }
}

/** Every settings object an import row can hold, as a plain record. */
export type SettingsDraft = AssetSettings & Record<string, unknown>;
