import { findScene } from '@three-studio/core';
import { useCallback, useState } from 'react';
import { DockLayout } from './shell/DockLayout';
import { MenuBar } from './shell/MenuBar';
import { StatusBar } from './shell/StatusBar';
import { Toolbar } from './shell/Toolbar';
import { clearLayout } from './shell/layoutStorage';
import { useShortcuts } from './shell/useShortcuts';
import { useProjectStore } from './state/projectStore';
import { useViewportStore } from './state/viewportStore';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { ImportDialog } from './import/ImportDialog';
import { PromptDialog } from './ui/PromptDialog';
import { ToastHost } from './ui/ToastHost';

export function App() {
  const [layoutResetToken, setLayoutResetToken] = useState(0);
  const summary = useProjectStore((s) => s.summary);
  const project = useProjectStore((s) => s.project);
  const sceneId = useProjectStore((s) => s.sceneId);
  const saveError = useProjectStore((s) => s.error);

  useShortcuts();

  const resetLayout = useCallback(() => {
    clearLayout();
    setLayoutResetToken((token) => token + 1);
  }, []);

  // The name the project gives the scene, not its file name. The two part
  // company the first time anyone renames a scene, and the name is the half
  // that is meant for a person to read — see ADR-15.
  const title =
    (project === null || sceneId === null ? undefined : findScene(project, sceneId)?.name) ??
    'Scene';

  return (
    <div className="flex h-full w-full flex-col bg-surface-0">
      {/* Each region is isolated: a failure in one must not blank the window,
          and must say which one it was. */}
      <ErrorBoundary area="Menu bar">
        <MenuBar
          title={`${summary?.name ?? 'Untitled'} — ${title}`}
          onResetLayout={resetLayout}
        />
      </ErrorBoundary>
      <ErrorBoundary area="Toolbar">
        <Toolbar onResetLayout={resetLayout} statusSlot={<BackendChip />} />
      </ErrorBoundary>
      {/* Deliberately not clipped. Dockview's render overlay does park hidden
          panels below the window, but `overflow: clip` on #root already hides
          that and removes the scrollport entirely. Clipping here as well would
          also trap floating panels inside the dock region, when they are meant
          to be draggable anywhere in the window. */}
      <div className="relative min-h-0 flex-1">
        <ErrorBoundary area="Panel layout">
          <DockLayout resetToken={layoutResetToken} />
        </ErrorBoundary>
      </div>
      {saveError && (
        <div className="shrink-0 bg-error/15 px-3 py-1 text-2xs text-error" data-selectable>
          Could not save: {saveError}
        </div>
      )}
      <StatusBar />
      <PromptDialog />
      <ImportDialog />
      <ToastHost />
    </div>
  );
}

/**
 * WebGPU is the intended backend; seeing WEBGL here means the device request
 * failed and performance characteristics will differ, so it is called out
 * rather than hidden.
 */
function BackendChip() {
  const backend = useViewportStore((s) => s.backend);
  if (!backend) return null;

  return (
    <span
      title={
        backend === 'webgpu'
          ? 'Rendering through the WebGPU backend'
          : 'WebGPU was unavailable — running on the WebGL2 fallback'
      }
      className={`rounded-sm px-1.5 py-0.5 font-mono text-2xs ${
        backend === 'webgpu' ? 'bg-play/15 text-play' : 'bg-warn/15 text-warn'
      }`}
    >
      {backend.toUpperCase()}
    </span>
  );
}
