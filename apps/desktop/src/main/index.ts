import { join } from 'node:path';
import { IPC_EVENTS } from '@three-studio/core';
import { BrowserWindow, app, session } from 'electron';
import { DeviceServer } from './devices/DeviceServer';
import { registerIpcHandlers } from './ipc';
import { handleAssetProtocol, handleImportProtocol, registerAssetScheme } from './protocol';
import { applyContentSecurityPolicy } from './security';
import { followWithSmokeDevice, runSmokeTest } from './smoke';
import {
  editorWindows,
  isSceneOpenElsewhere,
  isTransitioning,
  noteScene,
  onProjectLeft,
  openEditor,
  openLauncher,
  openSceneWindow,
  switchScene,
} from './windows';

// Must happen before the app is ready, or the scheme is treated as insecure
// and loaders cannot fetch through it.
registerAssetScheme();

/*
 * A software GPU, for a machine that has none.
 *
 * A CI runner has no graphics hardware, and Chromium will not fall back to
 * SwiftShader for WebGL on its own — software rendering is blocklisted, so the
 * canvas comes up with no context at all and three's `WebGPURenderer` has
 * nothing left to fall back to. What that produces is not a crash: it is a
 * window with the whole editor chrome painted and zero triangles in it, which
 * is exactly the "looks like it works" failure the harness exists to catch.
 *
 * Its own variable rather than part of `STUDIO_SMOKE`, because a developer's
 * machine has a GPU and forcing software rendering there would measure
 * something nobody ships. Must be set before the app is ready; switches
 * appended after that are ignored.
 */
if (process.env['STUDIO_SMOKE_SOFTWARE_GPU']) {
  app.commandLine.appendSwitch('use-gl', 'angle');
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
}

const isDev = !app.isPackaged;

void app.whenReady().then(() => {
  applyContentSecurityPolicy(session.defaultSession, isDev);
  handleAssetProtocol();
  handleImportProtocol();

  // A hidden window standing in for a phone, for the smoke harness. See
  // `followWithSmokeDevice`.
  const smokeDevice = process.env['STUDIO_SMOKE_DEVICE'] ? followWithSmokeDevice() : null;

  // What the device server says goes to every editor window alike: each one
  // shows the server, and any of them may be the one whose Console is open.
  const toEditors = (channel: string, payload: unknown): void => {
    for (const win of editorWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  };

  // One per process, and idle until something asks it to serve: it listens on
  // every interface, so it must never be listening without someone knowing.
  const devices = new DeviceServer({
    settingsFile: join(app.getPath('userData'), 'devices.json'),
    certificateFile: join(app.getPath('userData'), 'device-certificate.json'),
    // Where the exporter looks for the player: packaged, the app's resources;
    // in development, the workspace build.
    templateRoots: [process.resourcesPath, app.getAppPath()],
    onChange: (status) => {
      toEditors(IPC_EVENTS.devicesChanged, status);
      smokeDevice?.(status);
    },
    onLog: (logs) => toEditors(IPC_EVENTS.devicesLog, logs),
    trace: (line) => {
      if (isDev) console.log(`[devices] ${line}`);
    },
  });
  registerIpcHandlers({
    openEditor,
    switchScene,
    openSceneWindow,
    noteScene,
    isSceneOpenElsewhere,
    editorWindows,
    devices,
  });
  // Stopped with the project: the server serves the project's files, and
  // nothing else would close it once the last window showing them has gone.
  onProjectLeft(() => void devices.stop());
  app.on('will-quit', () => void devices.stop());

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
