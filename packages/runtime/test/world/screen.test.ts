import { describe, expect, it } from 'vitest';
import { ScreenLayers, type ScreenLayer } from '../../src/world/screen';
import { standInCanvas } from '../physics/rig';

function layer(order: number): ScreenLayer {
  return { element: standInCanvas().element, order };
}

describe('ScreenLayers', () => {
  it('orders back to front by order, ties in the order added', () => {
    const layers = new ScreenLayers();
    const front = layer(5);
    const first = layer(0);
    const second = layer(0);
    const back = layer(-1);
    for (const each of [front, first, second, back]) layers.add(each);
    expect(layers.all).toEqual([back, first, second, front]);
  });

  it('takes a layer out once on disposal, and tells the host each change', () => {
    const layers = new ScreenLayers();
    let told = 0;
    layers.onChange = () => (told += 1);
    const kept = layer(0);
    layers.add(kept);
    const added = layers.add(layer(1));
    added.dispose();
    added.dispose();
    expect(layers.all).toEqual([kept]);
    expect(told).toBe(3);
  });

  it('keeps the same array between changes', () => {
    const layers = new ScreenLayers();
    layers.add(layer(0));
    const before = layers.all;
    expect(layers.all).toBe(before);
    layers.add(layer(1));
    expect(layers.all).not.toBe(before);
  });
});
