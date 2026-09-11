import { createId } from '../../ids';
import type { PrefabInstanceComponent } from './schema';

/**
 * An instance component, pointing at nothing until something supplies the id.
 *
 * Its own factory because the literal was written out at nine call sites, and
 * every one of them had to be found again the day components gained an id.
 */
export function createPrefabInstance(assetId = ''): PrefabInstanceComponent {
  return { id: createId(), type: 'prefabInstance', assetId, overrides: {} };
}
