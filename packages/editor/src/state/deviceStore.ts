import type { DeviceServerStatus } from '@three-studio/core';
import { create } from 'zustand';

/**
 * The device server, as this window last heard of it.
 *
 * Held here rather than asked for: the server lives in the main process, one
 * per app, and any window — or a project's script — can start or stop it. The
 * main process sends every change to every editor window, so this is the one
 * copy the toolbar, the status bar and the commands read.
 */
interface DeviceState {
  /** `null` until the first reading arrives. */
  status: DeviceServerStatus | null;
}

export const useDeviceStore = create<DeviceState>()(() => ({ status: null }));

/**
 * Follows the server: every change, and one reading to start from.
 *
 * The reading is kept only if no change arrived while it was on its way: a
 * change sent meanwhile is newer, and the reading would put the window back in
 * the past — a server shown stopped that has just started. Returns the
 * unsubscribe.
 */
export function watchDevices(): () => void {
  let changed = false;
  const unsubscribe = window.studio.devices.onChanged((status) => {
    changed = true;
    useDeviceStore.setState({ status });
  });
  void window.studio.devices
    .status()
    .then((status) => {
      if (!changed) useDeviceStore.setState({ status });
    })
    // Nothing to show without one; the next change will say.
    .catch(() => undefined);
  return unsubscribe;
}
