import type { ComponentDoc } from '@three-studio/core';
import { audioPreview } from '../../audio/preview';
import type { ComponentSchema } from '../../inspector/fields';
import { peekViewport } from '../../viewport/viewportHost';

/** 3D falloff only matters once a source has some spatial blend. */
const isPositional = (component: ComponentDoc) =>
  component.type === 'audioSource' && component.spatialBlend > 0;

export const inspector: ComponentSchema = {
  label: 'Audio Source',
  fields: [
    // First, because everything below it is a way of shaping *this*. The
    // component has carried an `assetId` since the day it was added to the
    // schema and there was no way to fill it in until now.
    {
      path: ['assetId'],
      label: 'Clip',
      params: { view: 'asset', assetKind: 'audio' },
      toModel: (value) => value ?? '',
      fromModel: (value) => (value === '' ? null : value),
    },
    // Auditioned through the editor's own engine, never the game's: stopping
    // play must not stop a preview, and a preview must not turn up in the
    // game's mix (ADR-4).
    {
      kind: 'action',
      label: 'Preview',
      title: '▶  Play',
      run: ({ entityId, componentId, component }) => {
        if (component.type !== 'audioSource') return;
        audioPreview.playSource(
          entityId,
          componentId,
          component,
          peekViewport()?.binder.containerFor(entityId) ?? null,
        );
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
    { kind: 'separator' },

    { path: ['volume'], label: 'Volume', params: { min: 0, max: 2, step: 0.01 } },
    { path: ['pitch'], label: 'Pitch', params: { min: 0.1, max: 4, step: 0.01 } },
    // Cents. ±100 is a semitone, ±1200 an octave — the unit a variation is
    // written in, where `pitch` is the one a designer reaches for.
    { path: ['detune'], label: 'Detune', params: { min: -1200, max: 1200, step: 1 } },
    { path: ['mute'], label: 'Mute' },
    { path: ['loop'], label: 'Loop' },
    { path: ['playOnStart'], label: 'Play on start' },
    { kind: 'separator' },

    { path: ['startOffset'], label: 'Start offset', params: { min: 0, step: 0.01 } },
    { path: ['delay'], label: 'Delay', params: { min: 0, step: 0.01 } },
    { path: ['fadeIn'], label: 'Fade in', params: { min: 0, max: 30, step: 0.01 } },
    { path: ['fadeOut'], label: 'Fade out', params: { min: 0, max: 30, step: 0.01 } },
    // `0` is the highest, as in Unity. Idle until the voice ceiling is
    // reached, and then it decides everything.
    { path: ['priority'], label: 'Priority', params: { min: 0, max: 256, step: 1 } },
    { kind: 'separator' },

    {
      path: ['bus'],
      label: 'Bus',
      params: {
        options: { Master: 'master', Music: 'music', SFX: 'sfx', UI: 'ui', Ambience: 'ambience' },
      },
    },
    { kind: 'separator' },

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
    {
      path: ['spatialBlend'],
      label: 'Spatialize',
      toModel: (value) => Number(value) > 0,
      fromModel: (value) => (value ? 1 : 0),
    },
    {
      path: ['spatialBlend'],
      label: '2D  ↔  3D',
      params: { min: 0, max: 1, step: 0.01 },
    },
    {
      path: ['distanceModel'],
      label: 'Falloff',
      params: { options: { Inverse: 'inverse', Linear: 'linear', Exponential: 'exponential' } },
      visibleWhen: isPositional,
    },
    {
      path: ['refDistance'],
      label: 'Full volume within',
      params: { min: 0.1, max: 100, step: 0.1 },
      visibleWhen: isPositional,
    },
    {
      path: ['maxDistance'],
      label: 'Max distance',
      params: { min: 1, max: 2000, step: 1 },
      visibleWhen: isPositional,
    },
    {
      path: ['rolloffFactor'],
      label: 'Rolloff',
      params: { min: 0, max: 10, step: 0.1 },
      visibleWhen: isPositional,
    },
    {
      path: ['coneInnerAngle'],
      label: 'Cone inner',
      params: { min: 0, max: 360, step: 1 },
      visibleWhen: isPositional,
    },
    {
      path: ['coneOuterAngle'],
      label: 'Cone outer',
      params: { min: 0, max: 360, step: 1 },
      visibleWhen: isPositional,
    },
    {
      path: ['coneOuterGain'],
      label: 'Outside cone',
      params: { min: 0, max: 1, step: 0.01 },
      visibleWhen: isPositional,
    },
  ],
};
