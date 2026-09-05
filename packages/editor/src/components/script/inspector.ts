import type { ComponentDoc } from '@three-studio/core';
import type { ComponentSchema, FieldSpec } from '../../inspector/fields';
import { useAssetStore } from '../../state/assetStore';
import { useDocumentStore } from '../../state/documentStore';
import { useScriptStore } from '../../state/scriptStore';

export const inspector: ComponentSchema = {
  label: 'Script',
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
export function extraFields(component: ComponentDoc): readonly FieldSpec[] {
  if (component.type !== 'script' || component.assetId === '') return [];

  const declared = useScriptStore.getState().propertiesFor(component.assetId);

  return Object.entries(declared).map(([key, def]): FieldSpec => {
    const path = ['props', key];
    const label = def.label ?? key;
    // An unset property shows the value the script declared, so the panel and
    // the running script agree without having to write defaults into the scene.
    const fallback = 'default' in def ? def.default : undefined;
    // Coerced to the declared type, not passed through: a value saved by an
    // older version of the script (a string where a number is now declared)
    // would otherwise make Tweakpane build a text box instead of a slider.
    const toModel = (value: unknown) => {
      const raw = value ?? fallback;
      if (def.type === 'number') {
        const asNumber = typeof raw === 'number' ? raw : Number(raw);
        return Number.isFinite(asNumber) ? asNumber : (def.default ?? 0);
      }
      if (def.type === 'boolean') return typeof raw === 'boolean' ? raw : Boolean(raw);
      return raw;
    };

    switch (def.type) {
      case 'number':
        return {
          path,
          label,
          toModel,
          params: {
            ...(def.min === undefined ? {} : { min: def.min }),
            ...(def.max === undefined ? {} : { max: def.max }),
            ...(def.step === undefined ? {} : { step: def.step }),
          },
        };
      case 'enum':
        return {
          path,
          label,
          toModel: (value) => value ?? def.default ?? def.options[0],
          params: { options: Object.fromEntries(def.options.map((option) => [option, option])) },
        };
      case 'vec3':
        return {
          path,
          label,
          // Stored as a tuple in the document; Tweakpane wants an xyz object.
          toModel: (value) => {
            const v = (value ?? def.default ?? [0, 0, 0]) as [number, number, number];
            return { x: v[0], y: v[1], z: v[2] };
          },
          fromModel: (value) => {
            const v = value as { x: number; y: number; z: number };
            return [v.x, v.y, v.z];
          },
        };
      case 'entity':
        return {
          path,
          label,
          toModel: (value) => value ?? '',
          optionsProvider: () => {
            const scene = useDocumentStore.getState().scene;
            return {
              None: '',
              ...Object.fromEntries(
                Object.values(scene.entities).map((entity) => [entity.name, entity.id]),
              ),
            };
          },
        };
      case 'asset':
        return {
          path,
          label,
          toModel: (value) => value ?? '',
          optionsProvider: () => {
            const assets = useAssetStore.getState().manifest.assets;
            const matching = def.kind
              ? assets.filter((asset) => asset.kind === def.kind)
              : assets;
            return {
              None: '',
              ...Object.fromEntries(matching.map((asset) => [asset.name, asset.id])),
            };
          },
        };
      case 'boolean':
        return { path, label, toModel: (value) => value ?? def.default ?? false };
      case 'string':
      case 'color':
        return { path, label, toModel: (value) => value ?? def.default ?? '' };
    }
  });
}

