import {
  PLAYER_CONTROLLER_MODE_LABELS,
  TOUCH_CONTROLS_LABELS,
  optionsFrom,
} from '@three-studio/core';
import type { ComponentSchema } from '../../inspector/fields';

export const inspector: ComponentSchema = {
  label: 'Player Controller',
  fields: [
    {
      path: ['mode'],
      label: 'Mode',
      type: 'enum',
      options: optionsFrom(PLAYER_CONTROLLER_MODE_LABELS),
    },
    { path: ['moveSpeed'], label: 'Move speed', type: 'number', min: 0.1, max: 40, step: 0.1 },
    {
      path: ['sprintMultiplier'],
      label: 'Sprint ×',
      type: 'number', min: 1, max: 5, step: 0.1,
    },
    { path: ['jumpHeight'], label: 'Jump height', type: 'number', min: 0, max: 10, step: 0.1 },
    {
      path: ['mouseSensitivity'],
      label: 'Mouse sensitivity',
      type: 'number', min: 0.0002, max: 0.01, step: 0.0001,
    },
    /*
     * Shown in every mode, which it was not: it used to be hidden unless the
     * mode was `fps`, while TPS reads the very same field twice — as the height
     * of the point the camera orbits and of the point it looks at. So a third
     * person rig was pivoting about a number the Inspector refused to show.
     *
     * The label says where it is measured from because that is the question it
     * kept raising: from the feet, not from the entity's origin, which is the
     * middle of the collider.
     */
    {
      path: ['eyeHeight'],
      label: 'Eye height (from feet)',
      type: 'number', min: 0, max: 4, step: 0.05,
    },
    {
      path: ['cameraDistance'],
      label: 'Camera distance',
      type: 'number', min: 0.5, max: 25, step: 0.1,
      visibleWhen: (c) => c.type === 'playerController' && c.mode === 'tps',
    },
    // The camera this controller owns wins over any the scene carries, so
    // without this row a project had no way to ask for a different field.
    { path: ['fov'], label: 'Field of view', type: 'number', min: 30, max: 120, step: 1 },
    {
      path: ['touchControls'],
      label: 'Touch controls',
      type: 'enum',
      options: optionsFrom(TOUCH_CONTROLS_LABELS),
    },
    /*
     * Its own number rather than a reuse of the mouse sensitivity above, and
     * the units are why: a mouse reports a displacement that becomes an angle
     * once, a stick reports a deflection that is integrated over time. One
     * slider for both would be wrong in one of the two places whatever it held.
     */
    {
      path: ['touchLookSpeed'],
      label: 'Touch look speed',
      type: 'number', min: 0.5, max: 8, step: 0.1,
      visibleWhen: (c) => c.type === 'playerController' && c.touchControls !== 'never',
    },
  ],
};
