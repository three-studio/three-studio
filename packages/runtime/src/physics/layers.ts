import { DEFAULT_LAYER_ID, layersTouch, type CollisionLayer } from '@three-studio/core';

/**
 * Each layer's collision groups: its own bit in the sixteen high bits, the bits
 * of the layers it touches in the sixteen low ones (Rapier's
 * `InteractionGroups`). Rapier lets two colliders meet only when each one's bit
 * is among those the other touches, which is the matrix read both ways, by
 * contacts and sensors alike.
 *
 * Bits follow the table's order and live in the running world only: a collider
 * names its layer by id. An id the table does not hold gets Default's groups, as
 * `layersTouch` reads it. Numbers only, so no Rapier here, and no world to test it.
 */
export function collisionGroups(layers: readonly CollisionLayer[]): (layerId: string) => number {
  const groups = new Map(
    layers.map((layer, index): [string, number] => {
      const touched = layers.reduce(
        (bits, other, bit) => (layersTouch(layers, layer.id, other.id) ? bits | (1 << bit) : bits),
        0,
      );
      // Unsigned: the sixteenth layer's bit is a JavaScript number's sign bit.
      // Rapier read a negative one back unsigned, which is not worth relying on.
      return [layer.id, ((1 << (index + 16)) | touched) >>> 0];
    }),
  );
  // A table with no Default is one the settings' conformer never hands on: it
  // gets Rapier's own default, every bit, which is what it meant before layers.
  const asDefault = groups.get(DEFAULT_LAYER_ID) ?? 0xffff_ffff;
  return (layerId) => groups.get(layerId) ?? asDefault;
}
