import { useEffect, useState } from 'react';
import { App } from './App';
import { installDevtools } from './devtools';
import { layoutsLoaded, loadLayoutPreferences } from './shell/layoutStorage';
import { captureConsole } from './state/consoleStore';
import { LauncherApp } from './launcher/LauncherApp';
import { selectDirty, useDocumentStore } from './state/documentStore';
import { useProjectStore } from './state/projectStore';

// Installed at module scope so nothing logged during start-up is missed.
captureConsole();
installDevtools();

/**
 * Renders whichever window this is.
 *
 * Two windows, not two views of one: a launcher that picks a project and an
 * editor that edits it. The role arrives through the preload before the first
 * render, so neither shell is ever painted in the wrong window — which is what
 * asking for it over IPC would have cost.
 */
export function Root() {
  if (window.studio.windowRole === 'launcher') return <LauncherApp />;
  return <EditorWindow />;
}

function EditorWindow() {
  const summary = useProjectStore((s) => s.summary);
  const adopt = useProjectStore((s) => s.adopt);
  const adoptProject = useProjectStore((s) => s.adoptProject);
  const error = useProjectStore((s) => s.error);
  const setError = useProjectStore((s) => s.setError);
  const dirty = useDocumentStore(selectDirty);
  const [layoutsReady, setLayoutsReady] = useState(layoutsLoaded());

  // Read once, up front. dockview builds its arrangement synchronously, so
  // waiting until then would show the default layout and swap it a frame later.
  useEffect(() => {
    if (layoutsReady) return;
    void loadLayoutPreferences().finally(() => setLayoutsReady(true));
  }, [layoutsReady]);

  // The window is created for one project and opens it itself. The launcher
  // deliberately does not: it is about to be destroyed, and reading a project
  // into a renderer with seconds to live is work thrown away.
  useEffect(() => {
    const path = window.studio.projectPath;
    if (path === null || summary !== null) return;
    void window.studio.project
      // The scene id comes from the URL, so a window reopened by `switchScene`
      // lands on the one it was asked for rather than on the project's start
      // scene. Null falls back to that start scene, which is the first open.
      .open(path, window.studio.sceneId)
      .then(adopt)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  }, [adopt, setError, summary]);

  // Another window may add, rename or remove a scene at any moment, and this
  // window holds a copy of the project taken when it opened.
  useEffect(() => window.studio.project.onProjectChanged(adoptProject), [adoptProject]);

  // The main process needs the unsaved state to warn before closing; it has no
  // other view into the document.
  useEffect(() => {
    window.studio.project.setDirty(dirty);
  }, [dirty]);

  if (error !== null && summary === null) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-surface-0 p-8">
        <p className="max-w-lg text-center text-error" data-selectable>
          {error}
        </p>
      </div>
    );
  }

  // Blank until the project and the dock arrangement are both in hand. Both are
  // read at start-up and neither takes long enough to be worth a spinner.
  if (summary === null || !layoutsReady) return <div className="h-full w-full bg-surface-0" />;
  return <App />;
}
