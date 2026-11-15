import type { Infer, Schema } from '../../fieldSchema';
import { geometryField } from '../../scene/geometry';
import { materialFields } from '../../scene/material';
import type { Component } from '../../scene/primitives';

/** A primitive three draws, as its fields. The order is the pane's. */
export const meshSchema = {
  castShadow: { type: 'boolean', label: 'Cast shadows', default: true },
  receiveShadow: { type: 'boolean', label: 'Receive shadows', default: true },
  // Shape first: it is what the object is, and a displacement map is useless
  // without the segment counts that live here.
  geometry: { ...geometryField, separatorBefore: true },
  /*
   * A material asset it draws with, shared with every mesh linking it; none,
   * and it draws with its own, below. Linked, the rows below show and edit the
   * asset's values.
   */
  materialId: { type: 'asset', label: 'Material', kind: 'material', separatorBefore: true },
  material: { type: 'object', label: 'Material', linkedBy: 'materialId', fields: materialFields },
} as const satisfies Schema;

export type MeshComponent = Component<'mesh', Infer<typeof meshSchema>>;
