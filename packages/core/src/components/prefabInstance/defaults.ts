import type { AssetId } from '../../ids';
import { prefabInstanceType } from './index';
import type { PrefabInstanceComponent } from './schema';

/** An instance of the prefab `assetId`, overriding nothing. */
export function createPrefabInstance(assetId: AssetId | null = null): PrefabInstanceComponent {
  return { ...prefabInstanceType.create(), assetId };
}
