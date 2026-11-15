import type { AssetId } from '../../ids';
import { createEntity, type EntityTemplate } from '../../scene/entity';
import { modelType } from './index';

export function createModelEntity(assetId: AssetId, name: string): EntityTemplate {
  return createEntity(name, [{ ...modelType.create(), assetId }]);
}
