import { isRecord } from '../../conform';
import { checks, type DecodePath, type Decoded, type Diagnostic } from '../../decoded';
import type { Infer, Schema } from '../../fieldSchema';
import { isComponentId, isEntityId, type ComponentId, type EntityId } from '../../ids';
import type { Component, Transform } from '../../scene/primitives';

/**
 * What an instance changes of one entity of its prefab. Every part is
 * optional: an override holds what was changed, and nothing else.
 */
export interface PrefabOverride {
  name?: string;
  visible?: boolean;
  transform?: Partial<Transform>;
  /** By component id inside the prefab entity, then by property name. */
  components?: Record<ComponentId, Record<string, unknown>>;
}

/** The parts an override holds, and how far each is read here. */
const PARTS: ReadonlySet<string> = new Set(['name', 'visible', 'transform', 'components']);
const TRANSFORM: ReadonlySet<string> = new Set(['position', 'rotation', 'scale']);

/** One entity's override, its faults pushed at their paths. */
function decodeOverride(value: unknown, path: DecodePath, faults: Diagnostic[]): PrefabOverride | undefined {
  if (!isRecord(value)) {
    faults.push({ code: 'field.invalid', message: 'expected an override', path });
    return undefined;
  }
  const override: PrefabOverride = {};
  for (const key of Object.keys(value)) {
    if (!PARTS.has(key)) faults.push({ code: 'field.unexpected', message: 'is no part an override holds', path: [...path, key] });
  }
  const { name, visible, transform, components } = value;
  if (name !== undefined) {
    if (checks.string.is(name)) override.name = name;
    else faults.push({ code: 'field.invalid', message: 'expected a string', path: [...path, 'name'] });
  }
  if (visible !== undefined) {
    if (checks.boolean.is(visible)) override.visible = visible;
    else faults.push({ code: 'field.invalid', message: 'expected true or false', path: [...path, 'visible'] });
  }
  if (transform !== undefined) {
    if (!isRecord(transform)) {
      faults.push({ code: 'field.invalid', message: 'expected part of a transform', path: [...path, 'transform'] });
    } else {
      const partial: Partial<Transform> = {};
      for (const [axis, held] of Object.entries(transform)) {
        const at = [...path, 'transform', axis];
        if (!TRANSFORM.has(axis)) faults.push({ code: 'field.unexpected', message: 'is no part of a transform', path: at });
        else if (!checks.vec3.is(held)) faults.push({ code: 'field.invalid', message: 'expected three finite numbers', path: at });
        else if (axis === 'position') partial.position = held;
        else if (axis === 'rotation') partial.rotation = held;
        else partial.scale = held;
      }
      override.transform = partial;
    }
  }
  if (components !== undefined) {
    if (!isRecord(components)) {
      faults.push({ code: 'field.invalid', message: 'expected components by id', path: [...path, 'components'] });
    } else {
      const read: Record<ComponentId, Record<string, unknown>> = {};
      for (const [id, properties] of Object.entries(components)) {
        const at = [...path, 'components', id];
        if (!isComponentId(id)) faults.push({ code: 'field.invalid', message: 'expected a component id', path: at });
        // The properties are the component type's to judge, when the override
        // is applied: one that no longer fits is not applied, and stays.
        else if (!isRecord(properties)) faults.push({ code: 'field.invalid', message: 'expected properties by name', path: at });
        else read[id] = properties;
      }
      override.components = read;
    }
  }
  return override;
}

/**
 * An instance's overrides, keyed by the id each entity has inside the prefab —
 * through nested prefabs, `inner/lampRoot` — each decoded by hand: a record
 * keyed by ids, whose values hold only what an instance changed.
 */
function decodeOverrides(value: unknown, path: DecodePath): Decoded<Record<EntityId, PrefabOverride>> {
  if (!isRecord(value)) {
    return { ok: false, diagnostics: [{ code: 'field.invalid', message: 'expected overrides by entity', path }] };
  }
  const overrides: Record<EntityId, PrefabOverride> = {};
  const faults: Diagnostic[] = [];
  for (const [key, held] of Object.entries(value)) {
    if (!isEntityId(key)) {
      faults.push({ code: 'field.invalid', message: 'expected an entity id', path: [...path, key] });
      continue;
    }
    const override = decodeOverride(held, [...path, key], faults);
    if (override !== undefined) overrides[key] = override;
  }
  return faults.length === 0 ? { ok: true, value: overrides } : { ok: false, diagnostics: faults };
}

/**
 * An instance of a prefab asset, held by reference, as its fields.
 *
 * The scene stores one entity and this component, not a copy of the prefab's
 * contents. Unity serialises the same thing — a `PrefabInstance` plus a list of
 * modifications — and Godot's instanced scenes work the same way. The
 * alternative, writing the whole sub-tree into the scene, is what makes a
 * thousand trees a thousand copies.
 */
export const prefabInstanceSchema = {
  /* The prefab it places; none is an instance of nothing. */
  assetId: { type: 'asset', label: 'Prefab', kind: 'prefab' },
  /*
   * Per-entity changes, Unity's `m_Modifications`: what makes an instance worth
   * having — the prefab says what a tree is, the override says this one is
   * shorter. Its strings may name an entity of the prefab, which a copy renames.
   */
  overrides: { type: 'custom', label: 'Overrides', default: {}, decode: decodeOverrides, candidates: true },
} as const satisfies Schema;

export type PrefabInstanceComponent = Component<'prefabInstance', Infer<typeof prefabInstanceSchema>>;
