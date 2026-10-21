import { ENGINE_NAME } from '@three-studio/core';

/**
 * What the window is called, as `document.title`.
 *
 * On Windows and Linux the system's own frame shows it, and that frame is the
 * window's only title there. On macOS it names the window in the Window menu
 * and in Mission Control: each editor window by its scene, where every one of
 * them used to read "Three Studio".
 *
 * The mark for unsaved work goes first, where VS Code puts its own, so a title
 * cut short by a narrow taskbar button still shows it.
 */
export function windowTitle(project: string, scene: string, unsaved: boolean): string {
  return `${unsaved ? '● ' : ''}${project} — ${scene} — ${ENGINE_NAME}`;
}
