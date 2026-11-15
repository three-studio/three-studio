import { entitiesWith, isRecord, variantDefaults, waterSchema } from '@three-studio/core';
import { extendPane } from '../../inspector/fields';
import { useDocumentStore } from '../../state/documentStore';

/** What the sky and a sun of the surface's own are offered as, beside the lights by name. */
const SKY = 'sky';
const CUSTOM = 'custom';

/**
 * A water surface's pane is derived from its fields. What it adds is one
 * control for its sun: one question with one answer — the sky, a light in the
 * scene, or a sun of its own — where the union would offer a kind, then a
 * light. A dropdown rather than a reference picker, because the first and the
 * last choices are not entities, and a picker that had to carry them would be
 * two controls pretending to be one.
 */
export const pane = extendPane('water', {
  drawers: {
    sun: (row) =>
      row === null
        ? []
        : [
            {
              path: row.path,
              label: row.label,
              optionsProvider: () => {
                const scene = useDocumentStore.getState().scene;
                const lights = entitiesWith(scene, 'light')
                  .map((id) => scene.entities.get(id))
                  .filter((entity) => entity !== undefined);
                return {
                  'Sky (scene sun)': SKY,
                  ...Object.fromEntries(lights.map((entity) => [entity.name, entity.id])),
                  Custom: CUSTOM,
                };
              },
              // A light by its id, the two others by their kind.
              toModel: (sun) => (isRecord(sun) ? (sun['kind'] === 'light' ? (sun['entity'] ?? '') : sun['kind']) : sun),
              // A sun of its own starts from its defaults each time it is chosen.
              fromModel: (choice) =>
                choice === SKY || choice === CUSTOM
                  ? variantDefaults(waterSchema.sun, choice)
                  : { kind: 'light', entity: choice },
            },
          ],
  },
});
