import { RotateCw, TriangleAlert } from 'lucide-react';
import { useEffect, type RefObject } from 'react';
import { chooseDeviceAddress, restartDevice } from '../commands/deviceCommands';
import { commandById, type CommandId } from '../commands/registry';
import { refreshDevices } from '../state/deviceStore';
import { Popover } from '../ui/Popover';
import { QrCode } from '../ui/QrCode';
import type { DeviceDot, DeviceRow, DeviceView } from './deviceView';

/** Wide enough for the code beside a link that breaks over two lines at most. */
const WIDTH = 360;

/**
 * The code's side. With four modules of quiet zone, a link of this length
 * draws modules of about three pixels — what a phone at arm's length reads.
 */
const CODE_SIZE = 144;

const SELECT =
  'w-full rounded-xs border border-line-soft bg-surface-0 px-2 py-1 text-2xs text-ink outline-none focus:border-accent';

const BUTTON =
  'rounded-sm px-2 py-1 text-2xs text-ink-muted enabled:hover:bg-surface-3 enabled:hover:text-ink disabled:opacity-40';

const PRIMARY_BUTTON =
  'rounded-sm bg-accent-dim px-3 py-1 text-2xs text-ink enabled:hover:bg-accent/40 disabled:opacity-50';

const DOT_CLASSES: Readonly<Record<DeviceDot, string>> = {
  none: 'bg-ink-dim',
  starting: 'animate-pulse bg-accent',
  running: 'bg-ok',
  slid: 'bg-warn',
  error: 'bg-error',
};

/** The same tones, for a number standing where the dot would. */
const COUNT_CLASSES: Readonly<Record<DeviceDot, string>> = {
  none: 'text-ink-dim',
  starting: 'animate-pulse text-accent',
  running: 'text-ok',
  slid: 'text-warn',
  error: 'text-error',
};

/** The server's state as a coloured dot: on the button's icon, and beside the popover's state. */
export function StateDot({ dot, className = '' }: { dot: DeviceDot; className?: string }) {
  return <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASSES[dot]} ${className}`} />;
}

/** How many devices are connected, in the dot's place and tone. */
export function StateCount({
  dot,
  count,
  className = '',
}: {
  dot: DeviceDot;
  count: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`text-[9px] font-semibold leading-none tabular-nums ${COUNT_CLASSES[dot]} ${className}`}
    >
      {count}
    </span>
  );
}

/** A button that runs a command, and is greyed while it cannot. */
function Action({
  id,
  label,
  title,
  primary = false,
  className = '',
}: {
  id: CommandId;
  label: string;
  title?: string;
  primary?: boolean;
  className?: string;
}) {
  const command = commandById(id);
  return (
    <button
      type="button"
      title={title}
      disabled={!command.can()}
      onClick={() => command.run()}
      className={`${primary ? PRIMARY_BUTTON : BUTTON} ${className}`}
    >
      {label}
    </button>
  );
}

function PortLine({ view }: { view: DeviceView }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1 text-ink-muted">
        <span>Port {view.port}</span>
        <span aria-hidden>·</span>
        <Action id="deviceServerPort" label="Change…" className="-mx-1" />
      </div>
      {view.note !== null && <p className="text-warn">{view.note}</p>}
      {view.takeBack && (
        <Action
          id="reclaimDevicePort"
          label={`Take Back ${view.requestedPort}`}
          className="self-start border border-line-soft"
        />
      )}
    </div>
  );
}

function AddressPicker({ view }: { view: DeviceView }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-ink-muted">Address</span>
      <select
        value={view.address}
        onChange={(event) => void chooseDeviceAddress(event.target.value || null)}
        className={SELECT}
      >
        {view.addresses.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {view.addressNote !== null && <span className="text-ink-dim">{view.addressNote}</span>}
    </label>
  );
}

/** What a running server serves: the code beside the link, or why there is none. */
function Served({ view }: { view: DeviceView }) {
  const open = (
    <Action id="openDevicePage" label="Open in Browser" title={view.localUrl ?? undefined} />
  );
  const picker = view.addresses.length > 1 && <AddressPicker view={view} />;

  if (view.link === null) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-warn">No network address — only this computer can open the page.</p>
        <div>{open}</div>
        {picker}
        <PortLine view={view} />
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <QrCode text={view.link} size={CODE_SIZE} label={`QR code of ${view.link}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p data-selectable className="break-all font-mono text-ink">
          {view.link}
        </p>
        <div className="-mx-1 flex flex-wrap gap-1">
          <Action id="copyDeviceLink" label="Copy" />
          {open}
        </div>
        {picker}
        <PortLine view={view} />
      </div>
    </div>
  );
}

/**
 * One device: what it is, what it draws with — and why not WebGPU, when that
 * is why — its screen, and ↻. A failed page says what it failed on below it,
 * three lines at most; the whole of it in the title, and selectable.
 */
function DeviceItem({ row, insecureNote }: { row: DeviceRow; insecureNote: string }) {
  return (
    <li className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <StateDot dot={row.tone} />
        <span title={row.tooltip} className="min-w-0 flex-1 truncate text-ink">
          {row.label}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-ink-muted">
          {row.state}
          {row.backend !== null && row.insecure && (
            <span title={insecureNote} className="text-warn">
              <TriangleAlert size={12} strokeWidth={2} aria-label={insecureNote} />
            </span>
          )}
        </span>
        <span className="w-24 shrink-0 text-right tabular-nums text-ink-dim">{row.screen}</span>
        <button
          type="button"
          aria-label={`Restart ${row.label}`}
          title={`Restart ${row.label}`}
          disabled={!row.canRestart}
          onClick={() => void restartDevice(row.id)}
          className="-mr-1 shrink-0 rounded-sm p-1 text-ink-muted enabled:hover:bg-surface-3 enabled:hover:text-ink disabled:opacity-40"
        >
          <RotateCw size={12} strokeWidth={2} />
        </button>
      </div>
      {row.error !== null && (
        <p data-selectable title={row.error} className="line-clamp-3 pl-3.5 text-error">
          {row.error}
        </p>
      )}
    </li>
  );
}

/** Every device that opened the link, or how to get a first one. */
function Devices({ view }: { view: DeviceView }) {
  return (
    <section aria-label="Devices" className="flex flex-col gap-1.5">
      <h3 className="text-ink-muted">Devices</h3>
      {view.devicesNote !== null ? (
        <p className="text-ink-dim">{view.devicesNote}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {view.devices.map((row) => (
            <DeviceItem key={row.id} row={row} insecureNote={view.insecureNote} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Where devices are served, and how to change it: the code a phone scans, the
 * link, the address and the port, and what to check when a phone cannot
 * connect. Everything it says comes from `deviceView`.
 */
export function DevicePopover({
  anchor,
  view,
  onClose,
}: {
  anchor: RefObject<HTMLElement | null>;
  view: DeviceView;
  onClose: () => void;
}) {
  // The status reads the addresses anew, and nothing else says that this
  // computer joined another Wi-Fi while the server ran.
  useEffect(() => {
    void refreshDevices();
  }, []);

  let body;
  if (view.dot === 'running' || view.dot === 'slid') {
    body = <Served view={view} />;
  } else if (view.error !== null) {
    body = (
      <div className="flex flex-col gap-2">
        <p data-selectable className="text-error">
          {view.error}
        </p>
        <PortLine view={view} />
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-2">
        <p className="text-ink-muted">
          Launch runs the scene on screen on every device that opens the link. Nothing is saved.
        </p>
        <PortLine view={view} />
      </div>
    );
  }

  return (
    <Popover anchor={anchor} label="Run on Devices" width={WIDTH} onClose={onClose}>
      <div className="flex flex-col gap-3 p-3 text-2xs">
        <header className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-ink">Run on Devices</h2>
            <span className="flex items-center gap-1.5 text-ink-muted">
              <StateDot dot={view.dot} />
              {view.stateLabel}
            </span>
          </div>
          {(view.dot === 'running' || view.dot === 'slid') && (
            <p className="text-ink-muted">
              {view.sceneName === null
                ? 'Nothing launched yet: devices show a waiting page.'
                : `“${view.sceneName}”`}
            </p>
          )}
        </header>

        {body}

        {(view.dot === 'running' || view.dot === 'slid') && <Devices view={view} />}

        <details className="text-ink-muted">
          <summary className="cursor-default select-none hover:text-ink">Can’t connect?</summary>
          <div data-selectable className="mt-1.5 flex flex-col gap-1.5">
            <p>{view.help.lead}</p>
            <ul className="flex list-disc flex-col gap-1 pl-4">
              {view.help.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </details>
      </div>

      <footer className="flex items-center gap-2 border-t border-line-soft px-3 py-2">
        <Action id="newDeviceLink" label="New Link…" className="-ml-2 mr-auto" />
        <Action id="stopDeviceServer" label="Stop" />
        <Action id="launchOnDevices" label="Launch" primary />
      </footer>
    </Popover>
  );
}
