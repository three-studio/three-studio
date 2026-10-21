import { describe, expect, it } from 'vitest';
import { windowTitle } from '../src/shell/windowTitle';

/*
 * What the window is called. On Windows and Linux it is the only title the
 * window has, shown by the system's frame, so the project and the scene that
 * the editor's own title bar shows on macOS have to be in it.
 */

describe('the window title', () => {
  it('names the project, then the scene, then the application', () => {
    expect(windowTitle('FPS Blockout 2', 'main', false)).toBe('FPS Blockout 2 — main — Three Studio');
  });

  it('marks unsaved work first, where a title cut short still shows it', () => {
    expect(windowTitle('FPS Blockout 2', 'main', true)).toBe('● FPS Blockout 2 — main — Three Studio');
  });
});
