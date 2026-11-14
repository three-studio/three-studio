import type { AssetId } from '../../ids';
import type { ComponentBase, Vec3 } from '../../scene/primitives';

export type ScriptPropValue = number | string | boolean | Vec3;

export interface ScriptComponent extends ComponentBase {
  type: 'script';
  /** `''` is a script component with no script chosen. */
  assetId: AssetId | '';
  props: Record<string, ScriptPropValue>;
}
