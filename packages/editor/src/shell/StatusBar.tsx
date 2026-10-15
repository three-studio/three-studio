import { ENGINE_VERSION } from '@three-studio/core';
import { useDeviceStore } from '../state/deviceStore';
import { useEditorStore } from '../state/editorStore';

export function StatusBar() {
  const selection = useEditorStore((s) => s.selection);
  const playState = useEditorStore((s) => s.playState);
  const devices = useDeviceStore((s) => s.status);

  return (
    <div className="flex h-6 shrink-0 items-center gap-3 border-t border-line bg-surface-2 px-3 text-2xs text-ink-dim">
      <span>
        {selection.length === 0
          ? 'No selection'
          : selection.length === 1
            ? '1 object selected'
            : `${selection.length} objects selected`}
      </span>
      <div className="flex-1" />
      {playState !== 'stopped' && (
        <span className="text-play">{playState === 'playing' ? 'Playing' : 'Paused'}</span>
      )}
      {/* For as long as it runs: it listens on every interface, and a
          project's script can start it without anyone pressing anything. */}
      {devices?.state === 'running' && (
        <span title={devices.selectedUrl ?? undefined}>Serving devices</span>
      )}
      {/* Named, because it is not the installer's number and may differ from
          it — see the note on `ENGINE_VERSION`. */}
      <span title="Engine version">v{ENGINE_VERSION}</span>
    </div>
  );
}
