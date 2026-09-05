import type { ComponentBase, Vec3 } from '../../scene/primitives';

export type ScriptPropValue = number | string | boolean | Vec3;

export interface ScriptComponent extends ComponentBase {
  type: 'script';
  assetId: string;
  props: Record<string, ScriptPropValue>;
}
