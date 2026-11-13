import { describe, expect, it } from 'vitest';
import { lowPowerModeOn, powerSource } from '../report/conditions';

describe('the conditions read from pmset', () => {
  it('names the power source', () => {
    expect(powerSource("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged")).toBe('AC Power');
    expect(powerSource("Now drawing from 'Battery Power'\n")).toBe('Battery Power');
    expect(powerSource('')).toBe('unknown');
  });

  it('says whether Low Power Mode is on', () => {
    expect(lowPowerModeOn(' sleep                1\n lowpowermode         0\n')).toBe(false);
    expect(lowPowerModeOn(' sleep                1\n lowpowermode         1\n')).toBe(true);
  });
});
