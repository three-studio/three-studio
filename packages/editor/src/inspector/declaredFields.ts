import { fieldOptions, type FieldDef } from '@three-studio/core';
import { useAssetStore } from '../state/assetStore';
import { useDocumentStore } from '../state/documentStore';
import type { BoundSpec, Declared } from './fields';

/** A declared field and the key it is stored under. */
export type KeyedField = FieldDef & { key: string };

/**
 * What the declared type alone decides about a control.
 *
 * The single adapter between `core`'s `FieldDef` — which knows nothing of any
 * UI toolkit, because `core` depends on nothing — and Tweakpane. There were
 * two of these, one per producer, and neither served the component panes,
 * which reached for Tweakpane's own `BindingParams` instead.
 *
 * Only what the *type* forces is here. A tuple bound to a pad has to be
 * converted, whoever declared it; filling a missing value in does not, and
 * belongs to the producer that stores sparsely — see `specFor`.
 */
export function declaredControl(spec: Declared): {
  params?: Record<string, unknown>;
  toModel?: (value: unknown) => unknown;
  fromModel?: (value: unknown) => unknown;
  optionsProvider?: () => Record<string, string>;
} {
  switch (spec.type) {
    case undefined:
    case 'boolean':
    case 'string':
    case 'color':
      // Nothing to add: Tweakpane reads the value and builds the checkbox, the
      // text field or the colour picker on its own.
      return {};

    case 'number':
      // Tweakpane infers the widget from the value and narrows it with these.
      // Only the keys that were given: an explicit `undefined` is not the same
      // as an absent bound, and the declaration is what says which.
      return { params: bounds(spec) };

    case 'enum': {
      // Tweakpane wants label -> value, which is the reverse of how every
      // producer declares its options.
      const options = fieldOptions(spec.options);
      return { params: { options: Object.fromEntries(options.map((o) => [o.label, o.value])) } };
    }

    case 'vec2':
    case 'vec3': {
      // Stored as a tuple; Tweakpane's pad wants an object, and each axis
      // carries its own bounds so that `numeric()` can give it drag feel.
      const axes = spec.type === 'vec2' ? (['x', 'y'] as const) : (['x', 'y', 'z'] as const);
      const params = Object.fromEntries(axes.map((axis) => [axis, bounds(spec)]));
      return {
        params,
        toModel: (value) => {
          const tuple = value as readonly number[];
          return Object.fromEntries(axes.map((axis, index) => [axis, tuple[index]]));
        },
        fromModel: (value) => {
          const point = value as Record<string, number>;
          return axes.map((axis) => point[axis]);
        },
      };
    }

    case 'entity':
      return {
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
        optionsProvider: () => {
          const assets = useAssetStore.getState().manifest.assets;
          const matching = spec.kind ? assets.filter((a) => a.kind === spec.kind) : assets;
          return { None: '', ...Object.fromEntries(matching.map((a) => [a.name, a.id])) };
        },
      };
  }
}

/** The declared bounds, without the keys that were not declared. */
function bounds(spec: { min?: number; max?: number; step?: number }): Record<string, number> {
  return {
    ...(spec.min === undefined ? {} : { min: spec.min }),
    ...(spec.max === undefined ? {} : { max: spec.max }),
    ...(spec.step === undefined ? {} : { step: spec.step }),
  };
}

/**
 * One row from a producer that declares a *record* of fields.
 *
 * A script's properties and an importer's settings arrive keyed rather than as
 * an ordered list with a path each, so this is where the key becomes a path.
 * The rest of the control comes from the declaration, at bind time, like every
 * component row.
 *
 * The fallback chain — value, then declared default, then the type's zero — is
 * here rather than in `declaredControl` because it is a property of these two
 * producers and not of the types. A script's properties are stored *sparsely*:
 * `props` holds only what the designer has touched, so "no value yet" is the
 * ordinary case and a row that vanished for it would be a property that could
 * never be set. A component's fields are always present, and a missing one is
 * a document that needs migrating, not a row to invent a value for — which is
 * why `PaneBinder` skips it and says so.
 */
export function specFor(field: KeyedField, path: readonly string[]): BoundSpec {
  const control = declaredControl(field);
  const fallback = fallbackFor(field);

  return {
    ...field,
    path,
    label: field.label ?? field.key,
    ...(control.fromModel ? { fromModel: control.fromModel } : {}),
    toModel: (value) => {
      const raw = value ?? fallback;
      if (field.type === 'number') {
        // Coerced rather than passed through: a value saved by an older
        // version of a script — a string where a number is now declared —
        // would otherwise make Tweakpane build a text box instead of a slider,
        // and the row would look broken rather than stale.
        const asNumber = typeof raw === 'number' ? raw : Number(raw);
        return Number.isFinite(asNumber) ? asNumber : (field.default ?? 0);
      }
      return control.toModel ? control.toModel(raw) : raw;
    },
  };
}

/** What a row shows before anything has been stored for it. */
function fallbackFor(field: FieldDef): unknown {
  switch (field.type) {
    case 'number':
      return field.default ?? 0;
    case 'boolean':
      return field.default ?? false;
    case 'enum':
      return field.default ?? fieldOptions(field.options)[0]?.value;
    case 'vec2':
      return field.default ?? [0, 0];
    case 'vec3':
      return field.default ?? [0, 0, 0];
    case 'string':
    case 'color':
      return field.default ?? '';
    case 'entity':
    case 'asset':
      // No default to declare: a reference the designer has not made yet is
      // the empty choice, which the dropdown carries as `''`.
      return '';
  }
}
