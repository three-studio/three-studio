import { ENGINE_VERSION } from '@three-studio/core';
import { useEditorStore } from '../state/editorStore';

export function StatusBar() {
  const selection = useEditorStore((s) => s.selection);
  const playState = useEditorStore((s) => s.playState);

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
      <span>v{ENGINE_VERSION}</span>
    </div>
  );
}
