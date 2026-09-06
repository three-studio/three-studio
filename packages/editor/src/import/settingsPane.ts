import type { AssetSettings, FieldRow } from '@three-studio/core';
import type { FolderApi } from 'tweakpane';
import { specFor } from '../inspector/declaredFields';
import { PaneBinder } from '../inspector/PaneBinder';

/** What a button in the settings pane asks the dialog to do. */
export type ImportActionHandler = (key: string) => void;

/**
 * Renders an importer's declared fields, and writes back what is edited.
 *
 * The rows come from the importer as `FieldRow`s and are bound by `specFor`,
 * which is the same function that binds a script's declared properties — one
 * vocabulary, one adapter, whichever producer wrote the declaration.
 *
 * The settings object is mutated in place and `onChange` is told, so the caller
 * decides what a change means: for the import dialog it is a draft to keep, and
 * for a live preview it is a reason to redraw.
 */
export class ImportSettingsPane {
  private readonly binder: PaneBinder;

  constructor(
    container: HTMLElement,
    fields: readonly FieldRow[],
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

  private build(parent: FolderApi | PaneBinder['pane'], fields: readonly FieldRow[]): void {
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

      this.binder.bind(parent as FolderApi, specFor(field, [field.key]), {
        read: () => this.settings[field.key],
        write: (value) => {
          this.settings = { ...this.settings, [field.key]: value };
          this.onChange(this.settings);
        },
      });
    }
  }
}

/** Every settings object an import row can hold, as a plain record. */
export type SettingsDraft = AssetSettings & Record<string, unknown>;
