import { ENGINE_VERSION } from '@three-studio/core';
import { useEditorStore } from '../state/editorStore';
import { tooltip } from '../ui/Tooltip';

export function StatusBar() {
  const selection = useEditorStore((s) => s.selection);

  return (
    <div className="flex h-6 shrink-0 items-center gap-3 bg-surface-0 px-3 text-2xs text-ink-dim">
      <span>
        {selection.length === 0
          ? 'No selection'
          : selection.length === 1
            ? '1 object selected'
            : `${selection.length} objects selected`}
      </span>
      <div className="flex-1" />
      {/* No word for Play or Pause here: the transport lights its button, and
          the Viewport's play bar and badge say it where the game is. */}
      {/* Named, because it is not the installer's number and may differ from
          it — see the note on `ENGINE_VERSION`. */}
      <span {...tooltip('Engine version')}>v{ENGINE_VERSION}</span>
    </div>
  );
}
