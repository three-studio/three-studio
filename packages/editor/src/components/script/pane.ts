import { specFor } from '../../inspector/declaredFields';
import { extendPane } from '../../inspector/fields';
import { useScriptStore } from '../../state/scriptStore';

/**
 * A script's pane is derived from its fields: its script, as an asset slot.
 * What it adds is the properties that script declares, one row each.
 *
 * Rows the type alone cannot know: they are whatever the script's source says
 * today, so the *list* changes rather than which of a fixed list is visible.
 *
 * This is the feature that makes scripting usable by anyone but its author: a
 * value declared in the script becomes an editable field, saved per instance
 * with the scene. Unity's `[SerializeField]` and Unreal's `UPROPERTY` exist for
 * exactly this, and both engines would be unusable without it.
 */
export const pane = extendPane('script', {
  drawers: {
    props: (_row, script) =>
      script.assetId === null
        ? []
        : Object.entries(useScriptStore.getState().propertiesFor(script.assetId)).map(([key, def]) =>
            specFor({ ...def, key }, ['props', key]),
          ),
  },
  // Another script is another list, and so is the same script rebuilt: the
  // rows are derived once per key, and a recompile can change which properties
  // it declares without changing the script it is.
  paneKey: (script) => (script.assetId === null ? '' : `${script.assetId}@${useScriptStore.getState().revision}`),
});
