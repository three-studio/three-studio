import { createId } from '../ids';
import type { ComponentDoc, EntityDoc } from './schema';
import type { Transform } from './primitives';

/*
 * Making an entity, and nothing else.
 *
 * Split out of `defaults.ts` for the same reason `primitives.ts` was split out
 * of `schema.ts`: a component type in a folder of its own brings its entity
 * template with it — a light arrives posed, or it lights the horizon — and that
 * template needs `createEntity`. Leaving it in `defaults.ts`, which builds the
 * starter scene out of those same templates, would have made every slice with a
 * template an import cycle.
 */

export function createTransform(): Transform {
  return { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
}

/**
 * An entity and the components it carries, before either is in a document.
 *
 * The two are stored apart — the entity in `scene.entities`, its components in
 * `scene.components` — but they are *created* together, and every factory that
 * makes one makes both. Handing them back as a pair keeps the moment of
 * insertion a single call (`insertEntity`) that cannot write one and forget the
 * other.
 */
export interface EntityTemplate {
  entity: EntityDoc;
  components: ComponentDoc[];
}

export function createEntity(name: string, components: ComponentDoc[] = []): EntityTemplate {
  return {
    entity: {
      id: createId(),
      name,
      parent: null,
      children: [],
      transform: createTransform(),
      visible: true,
      locked: false,
    },
    components,
  };
}
