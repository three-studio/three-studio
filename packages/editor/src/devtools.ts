import { studioTime, type RuntimeRegistries } from '@three-studio/runtime';
import type { DockviewApi } from 'dockview-react';
import { audioPreview } from './audio/preview';
import { dockApi } from './shell/dockApi';
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
import type { EditorViewport } from './viewport/EditorViewport';
import { launchSnapshot } from './viewport/PlaySession';
import { peekViewport } from './viewport/viewportHost';

/** The stores `installDevtools` puts on `window.__studioStores`. */
export interface StudioDevtools {
  readonly asset: typeof useAssetStore;
  readonly console: typeof useConsoleStore;
  readonly devices: typeof useDeviceStore;
  readonly document: typeof useDocumentStore;
  readonly editor: typeof useEditorStore;
  readonly import: typeof useImportStore & { readonly open: typeof openImportDialog };
  readonly prefabMode: typeof usePrefabModeStore;
  readonly project: typeof useProjectStore;
  readonly script: typeof useScriptStore;
  readonly viewport: typeof useViewportStore;
}

/*
 * Declared rather than cast, so that the writes below need no assertion and a
 * script reading them — the perf harness's page functions — is typechecked
 * against the editor's real types: a field renamed here breaks the typecheck,
 * not a run. Optional, because they exist only once `installDevtools` has run.
 */
declare global {
  interface Window {
    __studioStores?: StudioDevtools;
    /** The window's registries, which the store actions that decode or expand take. */
    __studioRegistries?: RuntimeRegistries;
    __studioAudioPreview?: typeof audioPreview;
    __studioTime?: typeof studioTime;
    __studioLaunchSnapshot?: typeof launchSnapshot;
    readonly __studioViewport?: EditorViewport | null;
    readonly __studioDockApi?: DockviewApi | null;
  }
}

/**
 * Exposes the stores, the viewport and the dock on `window`, in development and
 * in a window the smoke harness drives.
 *
 * Zustand stores are module singletons with no DOM presence, so without this
 * neither the browser devtools console nor the headless smoke check can read or
 * drive editor state. The harness's window gets them in a production build
 * too: that build is the one measured, and without them neither draw calls,
 * GPU memory nor Play can be read there. A production window the harness does
 * not drive installs nothing.
 */
export function installDevtools(registries: RuntimeRegistries): void {
  if (!import.meta.env.DEV && !window.studio.smoke) return;

  // Beside the stores, because a page function driving them needs them: the
  // actions that read a prefab or a scene — `refresh`, `adopt` — take them.
  window.__studioRegistries = registries;
  window.__studioStores = {
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
  window.__studioAudioPreview = audioPreview;

  // Not a store either, and the same reason: every node material in the document
  // reads this clock, so "is the viewport animating, and at what rate" is a
  // question only it can answer — a screenshot of water cannot.
  window.__studioTime = studioTime;

  // What a device launch would send, read the way a launch reads it. Nothing
  // else can say whether a launch from Prefab Mode or during Play carries the
  // unsaved edits it should, short of a phone.
  window.__studioLaunchSnapshot = launchSnapshot;

  // The scene graph, otherwise unreachable from outside. A getter, so reading
  // it never creates the viewport — creation asks for a GPU device — and it
  // answers null until something has.
  Object.defineProperty(window, '__studioViewport', { get: peekViewport, configurable: true });

  // Dockview owns the layout imperatively and publishes nothing to React, so
  // this is the only way to inspect it or to open a panel from a check. Null
  // until the dock has mounted.
  Object.defineProperty(window, '__studioDockApi', { get: dockApi, configurable: true });
}
