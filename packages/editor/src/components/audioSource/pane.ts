import { audioPreview } from '../../audio/preview';
import { extendPane } from '../../inspector/fields';
import { peekViewport } from '../../viewport/viewportHost';

/**
 * An audio source's pane is derived from its fields, its clip first because
 * everything below it is a way of shaping *that*. What it adds: auditioning
 * the clip, and its spatial blend as a switch above the dial.
 */
export const pane = extendPane('audioSource', {
  after: {
    // Auditioned through the editor's own engine, never the game's: stopping
    // play must not stop a preview, and a preview must not turn up in the
    // game's mix.
    assetId: [
      {
        kind: 'action',
        label: 'Preview',
        title: '▶  Play',
        run: ({ entityId, componentId, component }) => {
          if (component.type !== 'audioSource') return;
          audioPreview.playSource(entityId, componentId, component, peekViewport()?.binder.containerFor(entityId) ?? null);
        },
      },
      {
        kind: 'action',
        title: '▌▌  Pause',
        run: () => {
          if (audioPreview.paused) audioPreview.resume();
          else audioPreview.pause();
        },
      },
      { kind: 'action', title: '■  Stop', run: () => audioPreview.stop() },
    ],
  },
  drawers: {
    // The same field twice, as a switch and as a dial.
    //
    // `spatialBlend` is a number and stays one: it is Unity's model, and
    // `Voice` honours it with a real crossfade between a flat branch and a
    // panned one, which is what lets a sound be pulled toward the ear without
    // losing where it is. But almost every source is at one end or the other,
    // and a slider is a poor way to ask a yes-or-no question — so the switch
    // is on top, writing 0 or 1, and the dial stays underneath for the sounds
    // that want to sit between them.
    //
    // Unchecking and rechecking gives 1, not whatever the dial said before:
    // `fromModel` is a pure function with nowhere to keep it.
    spatialBlend: (dial) =>
      dial === null
        ? []
        : [
            {
              path: dial.path,
              label: 'Spatialize',
              toModel: (value) => Number(value) > 0,
              fromModel: (value) => (value ? 1 : 0),
            },
            dial,
          ],
  },
});
