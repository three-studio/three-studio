import { afterEach, describe, expect, it, vi } from 'vitest';
import { showInFileManagerLabel } from '../src/platform';

/*
 * One gesture — show a file where it lives — went by two names: `Show in Finder`,
 * typed into two toasts on every platform, and `Reveal in file manager` on two
 * tooltips of the Project panel. The words now come from one place, in the
 * platform's own.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the words for showing a file', () => {
  it("are the platform's own", () => {
    expect(showInFileManagerLabel('darwin')).toBe('Show in Finder');
    expect(showInFileManagerLabel('win32')).toBe('Show in Explorer');
    expect(showInFileManagerLabel('linux')).toBe('Show in File Manager');
  });

  it('name no particular file manager with no bridge to ask', () => {
    // The editor also renders outside Electron, where nothing says which
    // platform this is.
    expect(showInFileManagerLabel()).toBe('Show in File Manager');
    vi.stubGlobal('window', {});
    expect(showInFileManagerLabel()).toBe('Show in File Manager');
  });

  it('read the platform when asked, not when the module loaded', () => {
    // This module loaded before the bridge below existed, as it does under every
    // test that stubs one: read at load time, the answer would still be the
    // default.
    vi.stubGlobal('window', { studio: { platform: 'win32' } });
    expect(showInFileManagerLabel()).toBe('Show in Explorer');
  });
});
