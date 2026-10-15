import { ChevronDown, Smartphone } from 'lucide-react';
import { useRef } from 'react';
import { commandById } from '../commands/registry';
import { setDevicePopoverOpen, useDeviceStore } from '../state/deviceStore';
import { useProjectStore } from '../state/projectStore';
import { toolTone } from '../ui/ToolButton';
import { DevicePopover, StateCount, StateDot } from './DevicePopover';
import { deviceView } from './deviceView';

/**
 * Runs what is on screen on every device, beside the transport.
 *
 * A split button, as `ToolSplitToggle` is: the body acts and the chevron
 * opens. The act is the one click this exists for — *Launch on Devices* — and
 * the popover is where the link is shown and changed. A dot on the icon
 * carries the server's state — the number of devices connected, once there
 * are some, in the same tone — and the tooltip the link it serves.
 */
export function DeviceButton({ className = '' }: { className?: string }) {
  const anchor = useRef<HTMLDivElement>(null);
  const status = useDeviceStore((s) => s.status);
  const open = useDeviceStore((s) => s.popoverOpen);
  // Read so that the button re-renders when it changes: whether a launch can
  // run is the open project's question.
  useProjectStore((s) => s.summary);

  const launch = commandById('launchOnDevices');
  const view = deviceView(status, {
    platform: window.studio.platform,
    dev: import.meta.env.DEV,
  });

  return (
    // The popover anchors to the whole button, so a click on the body launches
    // without dismissing it. `app-no-drag` is on the button itself: it hangs
    // outside the transport's box, and on macOS the toolbar's drag region
    // would otherwise take its clicks and move the window.
    <div ref={anchor} className={`app-no-drag flex items-center ${className}`}>
      <button
        type="button"
        aria-label="Launch on Devices"
        title={view.title}
        disabled={!launch.can()}
        onClick={() => launch.run()}
        className={`relative flex h-7 w-7 items-center justify-center rounded-l-sm transition-colors ${toolTone(false)} disabled:text-ink-dim disabled:hover:bg-transparent`}
      >
        <Smartphone size={15} strokeWidth={1.75} />
        {view.count > 0 ? (
          <StateCount dot={view.dot} count={view.count} className="absolute right-0.5 top-0.5" />
        ) : (
          view.dot !== 'none' && <StateDot dot={view.dot} className="absolute right-1 top-1" />
        )}
      </button>
      <button
        type="button"
        title="Run on Devices"
        aria-label="Run on Devices"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setDevicePopoverOpen(!open)}
        className={`flex h-7 items-center rounded-r-sm pl-0.5 pr-1 transition-colors ${toolTone(open)}`}
      >
        <ChevronDown size={11} strokeWidth={2} />
      </button>
      {open && (
        <DevicePopover anchor={anchor} view={view} onClose={() => setDevicePopoverOpen(false)} />
      )}
    </div>
  );
}
