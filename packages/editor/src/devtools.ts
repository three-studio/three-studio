import { studioTime } from '@three-studio/runtime';
import { audioPreview } from './audio/preview';
import { useAssetStore } from './state/assetStore';
import { openImportDialog, useImportStore } from './import/importStore';
import { useConsoleStore } from './state/consoleStore';
import { useDeviceStore } from './state/deviceStore';
import { useDocumentStore } from './state/documentStore';
import { useEditorStore } from './state/editorStore';
import { usePrefabModeStore } from './state/prefabModeStore';
import { useProjectStore } from './state/projectStore';
import { useScriptStore } from './state/scriptStore';
import { useViewportStore } from './state/viewportStore';
import { launchSnapshot } from './viewport/PlaySession';

/**
 * Exposes the stores on `window.__studioStores` in development.
 *
 * Zustand stores are module singletons with no DOM presence, so without this
 * neither the browser devtools console nor the headless smoke check can read or
 * drive editor state. Stripped from production builds by the `import.meta.env`
 * guard.
 */
export function installDevtools(): void {
  if (!import.meta.env.DEV) return;

  (globalThis as unknown as Record<string, unknown>)['__studioStores'] = {
    asset: useAssetStore,
    console: useConsoleStore,
    devices: useDeviceStore,
    document: useDocumentStore,
    editor: useEditorStore,
    // With the one action that opens it: the dialog is the only path assets
    // take into a project, so the headless check has to be able to start one.
    import: Object.assign(useImportStore, { open: openImportDialog }),
    prefabMode: usePrefabModeStore,
    project: useProjectStore,
    script: useScriptStore,
    viewport: useViewportStore,
  };

  // Not a store — an object owning an audio graph — but it is the only way to
  // ask "is the editor making a noise, and about which asset". Without it a
  // headless check can press Play and learn nothing.
  (globalThis as unknown as Record<string, unknown>)['__studioAudioPreview'] = audioPreview;

  // Not a store either, and the same reason: every node material in the document
  // reads this clock, so "is the viewport animating, and at what rate" is a
  // question only it can answer — a screenshot of water cannot.
  (globalThis as unknown as Record<string, unknown>)['__studioTime'] = studioTime;

  // What a device launch would send, read the way a launch reads it. Nothing
  // else can say whether a launch from Prefab Mode or during Play carries the
  // unsaved edits it should, short of a phone.
  (globalThis as unknown as Record<string, unknown>)['__studioLaunchSnapshot'] = launchSnapshot;
}
