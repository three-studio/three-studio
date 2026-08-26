import { BrowserWindow, app, session } from 'electron';
import { registerIpcHandlers } from './ipc';
import { handleAssetProtocol, handleImportProtocol, registerAssetScheme } from './protocol';
import { applyContentSecurityPolicy } from './security';
import { runSmokeTest } from './smoke';
import {
  editorWindows,
  isSceneOpenElsewhere,
  isTransitioning,
  noteScene,
  openEditor,
  openLauncher,
  openSceneWindow,
  switchScene,
} from './windows';

// Must happen before the app is ready, or the scheme is treated as insecure
// and loaders cannot fetch through it.
registerAssetScheme();

const isDev = !app.isPackaged;

void app.whenReady().then(() => {
  applyContentSecurityPolicy(session.defaultSession, isDev);
  handleAssetProtocol();
  handleImportProtocol();
  registerIpcHandlers({
    openEditor,
    switchScene,
    openSceneWindow,
    noteScene,
    isSceneOpenElsewhere,
    editorWindows,
  });

  // The check can start in either window. Given a project it boots straight
  // into the editor, because driving the launcher through a picker from a
  // script is a test of the picker, not of what is being checked.
  // Nothing is open yet, so neither call can be the "already editing" case that
  // returns null — but the check keeps that assumption out of the type system's
  // way if this ever moves.
  const smokeProject = process.env['STUDIO_SMOKE_PROJECT'];
  const win = smokeProject ? openEditor(smokeProject) : openLauncher();
  if (process.env['STUDIO_SMOKE'] && win) runSmokeTest(win);

  app.on('activate', () => {
    // macOS only, and only reachable while the app is still running with every
    // window closed — which this app does not do, since closing the launcher
    // quits. Kept as the belt to that brace.
    if (BrowserWindow.getAllWindows().length === 0) openLauncher();
  });
});

app.on('window-all-closed', () => {
  // Every platform, macOS included: closing the last window means leaving.
  // Except between projects: every editor window has to be gone before the
  // next one is built, because any of their prompts may still cancel, and that
  // gap would otherwise read here as "the user closed the last window".
  if (!isTransitioning()) app.quit();
});
