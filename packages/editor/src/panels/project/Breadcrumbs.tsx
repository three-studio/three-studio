import { ChevronRight } from 'lucide-react';
import { useAssetStore } from '../../state/assetStore';

/**
 * Where in `assets/` the panel is looking, and the way back up.
 *
 * It reaches the store itself rather than taking a callback, like every tile
 * below it: a fresh closure per render is what stops `memo` from meaning
 * anything, and there is nothing here the panel knows and this does not.
 */
export function Breadcrumbs({ folder, searching }: { folder: string; searching: boolean }) {
  const onNavigate = useAssetStore((s) => s.setFolder);
  const segments = folder === '' ? [] : folder.split('/');

  return (
    <div className="flex items-center gap-0.5 border-b border-line px-2 py-1 text-2xs text-ink-muted">
      <button type="button" onClick={() => onNavigate('')} className="hover:text-ink">
        Assets
      </button>
      {segments.map((segment, index) => (
        <span key={segment} className="flex items-center gap-0.5">
          <ChevronRight size={10} className="text-ink-dim" />
          <button
            type="button"
            onClick={() => onNavigate(segments.slice(0, index + 1).join('/'))}
            className={index === segments.length - 1 ? 'text-ink' : 'hover:text-ink'}
          >
            {segment}
          </button>
        </span>
      ))}
      {searching && <span className="ml-2 text-ink-dim">— searching the whole project</span>}
    </div>
  );
}
