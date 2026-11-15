import { createEntity, type EntityTemplate } from '../../scene/entity';
import { waterType } from './index';

export function createWaterEntity(): EntityTemplate {
  const template = createEntity('Water', [waterType.create()]);
  template.entity.transform.rotation = [-Math.PI / 2, 0, 0];
  return template;
}
