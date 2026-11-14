import type { ComponentDefinition } from '../registry';
import { createScript } from './defaults';
import type { ScriptComponent } from './schema';

/** A user script and its declared properties. */
export const scriptComponent: ComponentDefinition<ScriptComponent> = {
  id: 'script',
  label: 'Script',
  create: createScript,
  assets: (component) => [component.assetId],
  // Every string property, since only the script knows which hold assets.
  assetCandidates: (component) =>
    Object.values(component.props).filter((value): value is string => typeof value === 'string'),
  // A property may hold an entity's id, and only the script knows which.
  entities: () => [],
  placeable: () => true,
  runtime: true,
  addable: true,
};
