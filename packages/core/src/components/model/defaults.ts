import { createId } from '../../ids';
import { createEntity, type EntityTemplate } from '../../scene/entity';
import type { ModelComponent } from './schema';

/**
 * A model pointing at nothing, until a drop or an unpack supplies the ids.
 *
 * The last of what `blankComponent` held: one generic function over the four
 * types whose default is a plain literal, written that way so that a literal
 * repeated in a component module could not quietly stop matching its
 * interface. Its reason went with the folders — a factory beside its own type
 * is checked against it — and what is left of it is four ordinary factories.
 */
export function createModel(): ModelComponent {
  return {
    id: createId(),
    type: 'model',
    assetId: '',
    nodePath: '',
    nodeName: '',
    materialId: null,
    castShadow: true,
    receiveShadow: true,
  };
}

export function createModelEntity(assetId: string, name: string): EntityTemplate {
  return createEntity(name, [{ ...createModel(), assetId }]);
}
