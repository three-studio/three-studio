import type { AssetKind, ModelSettings, ModelSettingsBase } from '../../schema';
import { AssetImporter } from '../AssetImporter';
import { field, type FieldRow } from '../../../fields';

/** The action key the dialog answers with the model's bounding box. */
export const FIT_TO_METRE = 'fitToMetre';

/**
 * What every model format shares.
 *
 * The trunk is declared once, here, and each format adds only its own
 * difference — which is the whole reason the settings are a union on `format`
 * rather than one flat type with three formats' fields in it.
 */
export abstract class ModelImporter<S extends ModelSettings = ModelSettings> extends AssetImporter<S> {
  readonly kind: AssetKind = 'model';
  readonly directory = 'models';

  /** The trunk, in the shape a subclass spreads into its own defaults. */
  protected baseDefaults(): ModelSettingsBase {
    return {
      kind: 'model',
      scale: 1,
      upAxis: 'y',
      generateColliders: false,
      importMaterials: true,
      importAnimations: true,
      maxTextureSize: 2048,
    };
  }

  override fields(settings: S): readonly FieldRow[] {
    return [
      field.group('Model', [
        field.number('scale', 'Scale', { min: 0.000001, step: 0.01 }),
        // Needs the bounding box, which only exists once the file is open, so
        // the dialog answers it rather than the importer.
        field.action(FIT_TO_METRE, '', 'Fit to 1 m'),
        field.enum('upAxis', 'Up axis', [
          { value: 'y', label: 'Y up' },
          { value: 'z', label: 'Z up' },
        ]),
        field.toggle('importMaterials', 'Import materials'),
        field.toggle('importAnimations', 'Import animations'),
        field.toggle('generateColliders', 'Generate colliders'),
        // Applies to what the file carries inside itself. A model naming its
        // textures as separate files has none, and each of those is a texture
        // asset with a `maxSize` of its own.
        field.number('maxTextureSize', 'Max texture size', { min: 64, max: 16384, step: 64 }),
      ]),
      ...this.formatFields(settings),
    ];
  }

  /** Rows below the trunk. Empty is a fair answer — most formats decide little. */
  protected formatFields(_settings: S): readonly FieldRow[] {
    return [];
  }
}
