import { fieldOptions, type FieldDef } from '@three-studio/core';
import { useAssetStore } from '../state/assetStore';
import { useDocumentStore } from '../state/documentStore';
import type { BoundSpec } from './fields';

/** A declared field and the key it is stored under. */
export type KeyedField = FieldDef & { key: string };

/**
 * Binds one declared field to a control.
 *
 * The single adapter between `core`'s `FieldDef` — which knows nothing of any
 * UI toolkit, because `core` depends on nothing — and the Tweakpane rows the
 * inspector already speaks. There were two of these, one per producer: a
 * hundred lines for a script's properties and twenty-five for an importer's
 * settings, and they had already drifted apart on the things they shared.
 *
 * `path` is the caller's, because the two producers store their values in
 * different places: an import setting is a key on a flat settings object, and a
 * script property is `props.<key>` inside the component. Everything else about
 * a row — what control it is, how it converts, what it falls back to — is the
 * same question wherever the value ends up.
 *
 * Every row falls back to its declared default and then to the type's zero, and
 * that chain is here for the script half. A script's properties are stored
 * sparsely: `props` holds only what the designer has touched, so "no value yet"
 * is the ordinary case and a row that vanished for it would be a property that
 * could never be set. An import setting is never sparse — `defaultSettings`
 * fills every key and the sidecar upgrade refills it — so on that side the
 * chain never reaches past the stored value.
 */
export function specFor(field: KeyedField, path: readonly string[]): BoundSpec {
  const base = { path, label: field.label ?? field.key };

  switch (field.type) {
    case 'number':
      // Tweakpane infers the widget from the value and narrows it with these.
      // Only the keys that were given: an explicit `undefined` is not the same
      // as an absent bound, and the declaration is what says which.
      return {
        ...base,
        toModel: (value) => {
          // Coerced rather than passed through: a value saved by an older
          // version of a script — a string where a number is now declared —
          // would otherwise make Tweakpane build a text box instead of a
          // slider, and the row would look broken rather than stale.
          const raw = value ?? field.default ?? 0;
          const asNumber = typeof raw === 'number' ? raw : Number(raw);
          return Number.isFinite(asNumber) ? asNumber : (field.default ?? 0);
        },
        params: {
          ...(field.min === undefined ? {} : { min: field.min }),
          ...(field.max === undefined ? {} : { max: field.max }),
          ...(field.step === undefined ? {} : { step: field.step }),
        },
      };

    case 'boolean':
      // No params at all: a boolean is already a checkbox.
      return { ...base, toModel: (value) => value ?? field.default ?? false };

    case 'string':
    case 'color':
      return { ...base, toModel: (value) => value ?? field.default ?? '' };

    case 'enum': {
      // Tweakpane wants label -> value, which is the reverse of how both
      // producers declare their options.
      const options = fieldOptions(field.options);
      return {
        ...base,
        toModel: (value) => value ?? field.default ?? options[0]?.value,
        params: { options: Object.fromEntries(options.map((o) => [o.label, o.value])) },
      };
    }

    case 'vec3':
      return {
        ...base,
        // Stored as a tuple in the document; Tweakpane wants an xyz object.
        toModel: (value) => {
          const [x, y, z] = (value ?? field.default ?? [0, 0, 0]) as [number, number, number];
          return { x, y, z };
        },
        fromModel: (value) => {
          const { x, y, z } = value as { x: number; y: number; z: number };
          return [x, y, z];
        },
      };

    case 'entity':
      return {
        ...base,
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
        ...base,
        toModel: (value) => value ?? '',
        optionsProvider: () => {
          const assets = useAssetStore.getState().manifest.assets;
          const matching = field.kind
            ? assets.filter((asset) => asset.kind === field.kind)
            : assets;
          return { None: '', ...Object.fromEntries(matching.map((a) => [a.name, a.id])) };
        },
      };
  }
}
