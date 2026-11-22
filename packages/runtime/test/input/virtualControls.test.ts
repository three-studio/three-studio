import { describe, expect, it } from 'vitest';
import { VirtualControls, ZERO } from '../../src/input/VirtualControls';

describe('VirtualControls', () => {
  it('reads an axis as set, and ZERO when nothing set it', () => {
    const controls = new VirtualControls();
    expect(controls.axis('move')).toBe(ZERO);
    controls.setAxis('move', { x: 0.5, y: -1 });
    expect(controls.axis('move')).toEqual({ x: 0.5, y: -1 });
    expect(controls.axis('look')).toBe(ZERO);
  });

  it('presses and releases virtual keys', () => {
    const controls = new VirtualControls();
    controls.setKey('Space', true);
    expect(controls.isDown('Space')).toBe(true);
    controls.setKey('Space', false);
    expect(controls.isDown('Space')).toBe(false);
  });

  it('clears axes and keys together', () => {
    const controls = new VirtualControls();
    controls.setAxis('move', { x: 1, y: 0 });
    controls.setKey('ShiftLeft', true);
    controls.clear();
    expect(controls.axis('move')).toBe(ZERO);
    expect(controls.isDown('ShiftLeft')).toBe(false);
  });
});
