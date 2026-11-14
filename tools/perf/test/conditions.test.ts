import { describe, expect, it } from 'vitest';
import { lowPowerModeOn, powerSource, screenLockedIn } from '../report/conditions';

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

describe('the screen lock read from the IO registry', () => {
  // The root entry as `ioreg -n Root -d1` prints it, less the properties nothing here reads.
  const root = (locked: string): string =>
    ['+-o Root  <class IORegistryEntry, id 0x100000100, retain 43>', '    {', locked, '      "IOKitBuildVersion" = "Darwin Kernel Version 25.3.0"', '    }'].join('\n');

  it('says a locked screen is locked', () => {
    expect(screenLockedIn(root('      "IOConsoleLocked" = Yes'))).toBe(true);
  });

  it('says an unlocked one is not, whether the registry says No or says nothing', () => {
    expect(screenLockedIn(root('      "IOConsoleLocked" = No'))).toBe(false);
    expect(screenLockedIn(root('      "IOConsoleUsers" = ()'))).toBe(false);
    expect(screenLockedIn('unknown')).toBe(false);
  });
});
