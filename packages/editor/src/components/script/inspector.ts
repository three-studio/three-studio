import type { ComponentDoc } from '@three-studio/core';
import { specFor } from '../../inspector/declaredFields';
import type { ComponentSchema, FieldSpec } from '../../inspector/fields';
import { useAssetStore } from '../../state/assetStore';
import { useScriptStore } from '../../state/scriptStore';

export const inspector: ComponentSchema = {
  label: 'Script',
  extraFields,
  // A different script is a different set of rows, so the pane is rebuilt
  // rather than refreshed when the asset changes.
  paneKey: (component) =>
    component.type === 'script' ? `script:${component.assetId}` : 'script',
  fields: [
    {
      path: ['assetId'],
      label: 'Script',
      optionsProvider: () => {
        const scripts = useAssetStore.getState().byKind('script');
        return {
          None: '',
          ...Object.fromEntries(scripts.map((asset) => [asset.name, asset.id])),
        };
      },
    },
  ],
};

/**
 * Turns a script's declared properties into inspector fields.
 *
 * Rows the type alone cannot know: they are whatever the script's source says
 * today, so the *list* changes rather than which of a fixed list is visible.
 * That is why `paneEntriesFor` appends them rather than the schema declaring
 * them.
 *
 * This is the feature that makes scripting usable by anyone but its author: a
 * value declared in the script becomes an editable field, saved per instance
 * with the scene. Unity's `[SerializeField]` and Unreal's `UPROPERTY` exist for
 * exactly this, and both engines would be unusable without it.
 */
function extraFields(component: ComponentDoc): readonly FieldSpec[] {
  if (component.type !== 'script' || component.assetId === '') return [];

  const declared = useScriptStore.getState().propertiesFor(component.assetId);

  return Object.entries(declared).map(([key, def]) =>
    specFor({ ...def, key }, ['props', key]),
  );
}
