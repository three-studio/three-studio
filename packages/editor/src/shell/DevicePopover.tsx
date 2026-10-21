import type { DeviceTransport } from '@three-studio/core';
import {
  Camera,
  ChevronRight,
  CircleX,
  Copy,
  ExternalLink,
  RotateCw,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { Fragment, useEffect, useState, type ReactNode, type RefObject } from 'react';
import {
  captureDevice,
  chooseDeviceAddress,
  chooseDeviceTransport,
  restartDevice,
  setLaunchOptions,
  setLiveReload,
} from '../commands/deviceCommands';
import { commandById, type CommandId } from '../commands/registry';
import { refreshDevices } from '../state/deviceStore';
import { Popover } from '../ui/Popover';
import { QrCode } from '../ui/QrCode';
import type { CertificateView, DeviceDot, DeviceRow, DeviceView } from './deviceView';

/**
 * Wide enough for the link to fit on one line beside the code, and for each
 * setting's note to read in a line or two rather than down a column. At 360 px
 * the pickers shared what the code left, about 180 px, and cut both. An editor
 * window is at least 1100 px wide.
 */
const WIDTH = 600;

/**
 * The code's side. With four modules of quiet zone, a link of this length
 * draws modules of about three pixels — what a phone at arm's length reads.
 */
const CODE_SIZE = 144;

const SELECT =
  'w-full rounded-xs border border-line-soft bg-surface-0 px-2 py-1 text-2xs text-ink outline-none focus:border-accent';

/** The link, drawn as a field in the pickers' well: they are what it is made of. */
const FIELD =
  'break-all rounded-xs border border-line-soft bg-surface-0 px-2 py-1 font-mono text-ink';

/*
 * Three weights of button, each one a dialog already draws. With no ground, a
 * button read as one more word among the notes, so what a person reaches for
 * has a ground of its own, and the one click this exists for takes the accent.
 */
const BUTTON_TONES = {
  // The import and prompt dialogs' confirmation.
  primary:
    'rounded-sm bg-accent px-3 py-1 text-2xs font-medium text-white enabled:hover:brightness-110 disabled:opacity-40',
  // Package's Choose…, the launcher's Browse….
  secondary:
    'inline-flex items-center gap-1 rounded-sm bg-surface-3 px-2 py-1 text-2xs text-ink enabled:hover:bg-surface-4 disabled:opacity-40',
  // A dialog's Cancel: for what few want, and nobody should hit for another.
  plain:
    'rounded-sm px-2 py-1 text-2xs text-ink-muted enabled:hover:bg-surface-3 enabled:hover:text-ink disabled:opacity-40',
} as const;

type ButtonTone = keyof typeof BUTTON_TONES;

/*
 * A part of the popover under a hairline, as a panel's sections are. The
 * titles are the dialogs' group headings a shade lighter: `ink-dim` on this
 * ground is about 2.5:1, too faint for what is read at a glance.
 */
const SECTION = 'flex flex-col gap-2.5 border-t border-line-soft px-3 py-3';
const SECTION_TITLE = 'text-2xs font-medium uppercase tracking-wide text-ink-muted';

/**
 * A setting's row, its name on the left as the dialogs' `Field` has it, in a
 * column narrow enough for a popover. The control takes the rest of the width,
 * and what it says goes under it.
 */
const ROW = 'grid grid-cols-[4rem_minmax(0,1fr)] items-start gap-x-2';
const ROW_LABEL = 'pt-1 text-ink-muted';

/** The rows of a list, ruled apart in a well one step darker, as Package lists its scenes. */
const LIST =
  'flex flex-col divide-y divide-line-soft/60 rounded-sm border border-line-soft bg-surface-1';
const LIST_ROW = 'px-2 py-1.5';

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

/** The same tones again, as the ground of the popover's state. */
const BADGE_CLASSES: Readonly<Record<DeviceDot, string>> = {
  none: 'bg-surface-3 text-ink-muted',
  starting: 'bg-accent/15 text-accent',
  running: 'bg-ok/15 text-ok',
  slid: 'bg-warn/15 text-warn',
  error: 'bg-error/15 text-error',
};

const CALLOUT_TONES = {
  warning: { icon: TriangleAlert, box: 'border-warn/40 bg-warn/10', mark: 'text-warn' },
  error: { icon: CircleX, box: 'border-error/50 bg-error/10', mark: 'text-error' },
} as const;

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

/**
 * The server's state as a badge: the dot and its words on a ground of their
 * tone, so that Running and Could not start differ before either is read.
 */
function StatusBadge({ dot, label }: { dot: DeviceDot; label: string }) {
  return (
    <span
      className={`flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 ${BADGE_CLASSES[dot]}`}
    >
      <StateDot dot={dot} />
      {label}
    </span>
  );
}

/** A button that runs a command, and is greyed while it cannot. */
function Action({
  id,
  label,
  title,
  tone = 'plain',
  icon: Icon,
  className = '',
}: {
  id: CommandId;
  label: string;
  title?: string;
  tone?: ButtonTone;
  icon?: LucideIcon;
  className?: string;
}) {
  const command = commandById(id);
  return (
    <button
      type="button"
      title={title}
      disabled={!command.can()}
      onClick={() => command.run()}
      className={`${BUTTON_TONES[tone]} ${className}`}
    >
      {Icon !== undefined && <Icon size={11} aria-hidden />}
      {label}
    </button>
  );
}

/**
 * What is wrong, boxed in its tone together with what to do about it, as
 * `Alert` tints a toast: the mark and the edge carry the tone, and the words
 * stay in ink. A sentence in yellow or red read as one more note, and a long
 * one was hard to read at all.
 */
function Callout({ tone, children }: { tone: keyof typeof CALLOUT_TONES; children: ReactNode }) {
  const { icon: Icon, box, mark } = CALLOUT_TONES[tone];
  return (
    <div className={`flex gap-2 rounded-sm border p-2 ${box}`}>
      <Icon size={13} strokeWidth={2} aria-hidden className={`mt-px shrink-0 ${mark}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-ink">{children}</div>
    </div>
  );
}

/**
 * A part folded under its title: help, or settings most launches leave alone.
 *
 * `<details>` still does the folding, so the keyboard and a screen reader have
 * it for nothing; only its look is the editor's. The browser's triangle gives
 * way to the chevron `Alert` turns on its details, and the whole title is the
 * target. What is set inside can be said beside the title, cut short when long.
 */
function Disclosure({
  title,
  aside = null,
  open,
  onOpenChange,
  selectable = false,
  children,
}: {
  title: string;
  aside?: string | null;
  /** Given, the caller holds whether it is open; left out, the element does. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  selectable?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={open}
      onToggle={(event) => onOpenChange?.(event.currentTarget.open)}
      className="group/disclosure"
    >
      <summary className="-mx-1.5 flex select-none list-none items-center gap-1 rounded-sm px-1.5 py-1 text-ink-muted hover:bg-surface-3 hover:text-ink group-open/disclosure:text-ink">
        <ChevronRight
          size={12}
          strokeWidth={2}
          aria-hidden
          className="shrink-0 transition-transform group-open/disclosure:rotate-90"
        />
        <span className="shrink-0">{title}</span>
        {aside !== null && (
          <span title={aside} className="ml-auto min-w-0 truncate pl-2 text-ink-dim">
            {aside}
          </span>
        )}
      </summary>
      <div
        data-selectable={selectable || undefined}
        className="flex flex-col gap-2 pb-1 pl-4 pt-1.5 text-ink-muted"
      >
        {children}
      </div>
    </details>
  );
}

function PortRow({ view }: { view: DeviceView }) {
  return (
    <div className={ROW}>
      <span className={ROW_LABEL}>Port</span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="tabular-nums text-ink">{view.port}</span>
          <Action id="deviceServerPort" label="Change…" tone="secondary" />
        </div>
        {(view.note !== null || view.takeBack) && (
          <Callout tone="warning">
            {view.note !== null && <p>{view.note}</p>}
            {view.takeBack && (
              <Action
                id="reclaimDevicePort"
                label={`Take Back ${view.requestedPort}`}
                tone="secondary"
                className="self-start"
              />
            )}
          </Callout>
        )}
      </div>
    </div>
  );
}

function AddressRow({ view }: { view: DeviceView }) {
  return (
    <label className={ROW}>
      <span className={ROW_LABEL}>Address</span>
      <span className="flex min-w-0 flex-col gap-1">
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
      </span>
    </label>
  );
}

const TRANSPORTS: readonly { value: DeviceTransport; label: string }[] = [
  { value: 'http', label: 'HTTP' },
  { value: 'https', label: 'HTTPS' },
];

/**
 * Plain HTTP or HTTPS, and what each gives a phone. Shown whether the server
 * runs or not: a stopped one starts on what is chosen here.
 *
 * Two segments rather than a picker: there are two choices, and both stay in
 * sight, so the one not taken is a click away instead of behind a list. Radios
 * underneath, which gives them the arrow keys for nothing. Under them, only
 * what the choice made gives and asks — and, under HTTPS alone, how to accept
 * its certificate, which reads as the price of that choice where it hangs.
 */
function ProtocolRow({ view }: { view: DeviceView }) {
  return (
    <div className={ROW}>
      <span className={ROW_LABEL}>Protocol</span>
      <div className="flex min-w-0 flex-col gap-1">
        <div
          role="radiogroup"
          aria-label="Protocol"
          className="grid grid-cols-2 gap-0.5 rounded-sm border border-line-soft bg-surface-0 p-0.5"
        >
          {TRANSPORTS.map(({ value, label }) => (
            <label
              key={value}
              className="rounded-xs py-0.5 text-center text-ink-muted hover:text-ink has-checked:bg-accent-dim has-checked:text-ink has-focus-visible:ring-1 has-focus-visible:ring-accent"
            >
              <input
                type="radio"
                name="device-transport"
                value={value}
                checked={view.transport === value}
                onChange={() => void chooseDeviceTransport(value)}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
        <p className="text-ink-dim">{view.transportNote}</p>
        {view.certificate !== null && <Certificate certificate={view.certificate} />}
      </div>
    </div>
  );
}

/**
 * Live reload, whatever the server's state: the setting is kept. Its note says
 * what it does in this window now — waiting for a launch, following another
 * window, paused by a refusal, or relaunching.
 */
function LiveReload({ view }: { view: DeviceView }) {
  const { on, note, tone, title } = view.liveReload;
  return (
    <div className="flex flex-col gap-0.5">
      <label title={title} className="flex items-center gap-2 self-start text-ink">
        <input
          type="checkbox"
          checked={on}
          onChange={(event) => void setLiveReload(event.target.checked)}
        />
        Live reload
      </label>
      {note !== null && (
        <p className={`pl-5 ${tone === 'warning' ? 'text-warn' : 'text-ink-dim'}`}>{note}</p>
      )}
    </div>
  );
}

/** A checkbox, and what ticking it does beneath. */
function Option({
  label,
  checked,
  note,
  onChange,
}: {
  label: string;
  checked: boolean;
  note: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="flex items-center gap-2 self-start text-ink">
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        {label}
      </label>
      <p className="pl-5 text-ink-dim">{note}</p>
    </div>
  );
}

/**
 * What every device is launched with, beyond what the project says: shut
 * unless opened, since most launches want the project as it is, and its title
 * says what is set otherwise. Whatever the server's state: the options are
 * kept, and a stopped server starts on them.
 */
function LaunchOptions({ view }: { view: DeviceView }) {
  const options = view.launchOptions;
  return (
    <Disclosure title="Launch options" aside={options.summary}>
      <Option
        label="Force WebGL2"
        checked={options.forceWebGL}
        note="Every device restarts on it."
        onChange={(forceWebGL) => void setLaunchOptions({ forceWebGL })}
      />
      <label className={ROW}>
        <span className={ROW_LABEL}>Pixel ratio</span>
        <span className="flex min-w-0 flex-col gap-1">
          <select
            value={options.pixelRatio}
            onChange={(event) => {
              const value = event.target.value;
              void setLaunchOptions({ maxPixelRatio: value === '' ? null : Number(value) });
            }}
            className={SELECT}
          >
            {options.pixelRatios.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="text-ink-dim">Every device restarts on it.</span>
        </span>
      </label>
      <Option
        label="Stats on screen"
        checked={options.stats}
        note="Each device draws its numbers in a corner, without restarting."
        onChange={(stats) => void setLaunchOptions({ stats })}
      />
    </Disclosure>
  );
}

/**
 * How to get each phone past the warning, and what to compare before
 * accepting. Open as the view says when it first shows, and opened again
 * whenever a reason to read it appears — the server started with no device
 * yet, a browser held at the warning, a new certificate — which is the first
 * time through: HTTPS chosen while stopped, then Launch. Never shut by one of
 * those reasons going: a device connecting does not fold it under the
 * person's eyes, and what they open or shut stays so.
 */
function Certificate({ certificate }: { certificate: CertificateView }) {
  const [open, setOpen] = useState(certificate.open);
  useEffect(() => {
    if (certificate.open) setOpen(true);
  }, [certificate.open]);
  return (
    <Disclosure title="Accepting the certificate" open={open} onOpenChange={setOpen} selectable>
      {certificate.renewedNote !== null && <p className="text-warn">{certificate.renewedNote}</p>}
      <p>{certificate.lead}</p>
      <ul className="flex list-disc flex-col gap-1 pl-4">
        {certificate.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ul>
      {certificate.check !== null && <p>{certificate.check}</p>}
      {certificate.fingerprint !== null && (
        <div className="flex items-start gap-2">
          <span className="shrink-0 pt-1">SHA-256</span>
          {/* It may wrap only between two groups: it is compared with the
              phone's a group at a time, and a group cut in two reads as two.
              `<wbr>` rather than a zero-width space, which a copy would keep. */}
          <span
            data-selectable
            className="min-w-0 flex-1 break-words rounded-xs bg-surface-0 px-2 py-1 font-mono text-ink"
          >
            {certificate.fingerprint.split(':').map((group, index) => (
              <Fragment key={index}>
                {index > 0 && (
                  <>
                    :<wbr />
                  </>
                )}
                {group}
              </Fragment>
            ))}
          </span>
        </div>
      )}
      <p>{certificate.lifetime}</p>
    </Disclosure>
  );
}

/** What to check when a phone cannot open the link, whichever the protocol. */
function Help({ help }: { help: DeviceView['help'] }) {
  return (
    <Disclosure title="Can’t connect?" selectable>
      <p>{help.lead}</p>
      <ul className="flex list-disc flex-col gap-1 pl-4">
        {help.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </Disclosure>
  );
}

/** What a running server serves: the code beside the link, or why there is none. */
function Served({ view }: { view: DeviceView }) {
  const open = (
    <Action
      id="openDevicePage"
      label="Open in Browser"
      title={view.localUrl ?? undefined}
      tone="secondary"
      icon={ExternalLink}
    />
  );

  if (view.link === null) {
    return (
      <Callout tone="warning">
        <p>No network address — only this computer can open the page.</p>
        <div>{open}</div>
      </Callout>
    );
  }
  return (
    <div className="flex gap-3">
      <QrCode text={view.link} size={CODE_SIZE} label={`QR code of ${view.link}`} />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
        <p data-selectable className={FIELD}>
          {view.link}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Action id="copyDeviceLink" label="Copy" tone="secondary" icon={Copy} />
          {open}
        </div>
      </div>
    </div>
  );
}

/**
 * One device: what it is, what it draws with — and why not WebGPU, when that
 * is why — its screen, its camera and ↻. Below it, what its page measured on
 * one line, every number in the title, then what looks wrong with the page, a
 * line each. A failed page says what it failed on, three lines at most; the
 * whole of it in the title, and selectable.
 */
function DeviceItem({ row, view }: { row: DeviceRow; view: DeviceView }) {
  const why = row.insecure ? view.insecureNote : row.noWebGpu ? view.noWebGpuNote : null;
  return (
    <li className={`${LIST_ROW} flex flex-col gap-0.5`}>
      <div className="flex items-center gap-2">
        <StateDot dot={row.tone} />
        <span title={row.tooltip} className="min-w-0 flex-1 truncate text-ink">
          {row.label}
        </span>
        <span
          title={row.backendTitle ?? undefined}
          className="flex shrink-0 items-center gap-1 text-ink-muted"
        >
          {row.state}
          {row.backend !== null && why !== null && (
            <span title={why} className="text-warn">
              <TriangleAlert size={12} strokeWidth={2} aria-label={why} />
            </span>
          )}
        </span>
        <span className="w-24 shrink-0 text-right tabular-nums text-ink-dim">{row.screen}</span>
        <button
          type="button"
          aria-label={`Take a screenshot on ${row.label}`}
          title={`Take a screenshot on ${row.label}`}
          disabled={!row.canCapture || row.capturing}
          onClick={() => void captureDevice(row.id)}
          className={`shrink-0 rounded-sm p-1 text-ink-muted enabled:hover:bg-surface-3 enabled:hover:text-ink disabled:opacity-40 ${row.capturing ? 'animate-pulse' : ''}`}
        >
          <Camera size={12} strokeWidth={2} />
        </button>
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
      {row.stats !== null ? (
        <p title={row.statsTitle ?? undefined} className="truncate pl-3.5 tabular-nums text-ink-muted">
          {row.stats}
        </p>
      ) : (
        row.measuring && <p className="pl-3.5 text-ink-dim">Measuring…</p>
      )}
      {row.warnings.map((warning) => (
        <p key={warning} className="flex gap-1 pl-3.5 text-warn">
          <TriangleAlert size={12} strokeWidth={2} aria-hidden className="mt-px shrink-0" />
          <span>{warning}</span>
        </p>
      ))}
      {row.error !== null && (
        <p data-selectable title={row.error} className="line-clamp-3 pl-3.5 text-error">
          {row.error}
        </p>
      )}
    </li>
  );
}

/**
 * Every device that opened the link, or how to get a first one — after the
 * addresses held at the certificate's warning, which have no row to restart
 * yet. One list either way, so that its well is never empty.
 */
function Devices({ view }: { view: DeviceView }) {
  return (
    <section aria-label="Devices" className={SECTION}>
      <h3 className={SECTION_TITLE}>Devices</h3>
      <ul className={LIST}>
        {view.waiting.map((waiting) => (
          <li key={waiting.address} className={`${LIST_ROW} flex items-center gap-2 text-warn`}>
            <StateDot dot="slid" />
            <span className="min-w-0 flex-1">{waiting.label}</span>
          </li>
        ))}
        {view.devicesNote !== null ? (
          <li className={`${LIST_ROW} text-ink-muted`}>{view.devicesNote}</li>
        ) : (
          view.devices.map((row) => <DeviceItem key={row.id} row={row} view={view} />)
        )}
      </ul>
    </section>
  );
}

/**
 * Where devices are served, and how to change it, in the order a first launch
 * goes through it: the code a phone scans and its link; under them, what the
 * link is made of — the address, the protocol, the port — with the help for a
 * phone that cannot get in; then the devices that did; and last what every
 * launch carries, just above the button that launches. Everything it says
 * comes from `deviceView`.
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

  const running = view.dot === 'running' || view.dot === 'slid';

  let hero;
  if (running) {
    hero = <Served view={view} />;
  } else if (view.error !== null) {
    hero = (
      <Callout tone="error">
        <p data-selectable>{view.error}</p>
      </Callout>
    );
  } else {
    hero = (
      <p className="text-ink-muted">
        Launch runs the scene on screen on every device that opens the link. Nothing is saved.
      </p>
    );
  }

  return (
    <Popover anchor={anchor} label="Run on Devices" width={WIDTH} onClose={onClose}>
      <div className="text-2xs">
        <div className="flex flex-col gap-3 p-3">
          <header className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-medium text-ink">Run on Devices</h2>
              <StatusBadge dot={view.dot} label={view.stateLabel} />
            </div>
            {running && (
              <p className="text-ink-muted">
                {view.sceneName === null ? (
                  'Nothing launched yet: devices show a waiting page.'
                ) : (
                  <>
                    Scene <span className="text-ink">“{view.sceneName}”</span>
                  </>
                )}
              </p>
            )}
          </header>

          {hero}
        </div>

        <section aria-label="Connection" className={SECTION}>
          <h3 className={SECTION_TITLE}>Connection</h3>
          {running && view.addresses.length > 1 && <AddressRow view={view} />}
          <ProtocolRow view={view} />
          <PortRow view={view} />
          <Help help={view.help} />
        </section>

        {running && <Devices view={view} />}

        <section aria-label="Launch" className={SECTION}>
          <h3 className={SECTION_TITLE}>Launch</h3>
          <LiveReload view={view} />
          <LaunchOptions view={view} />
        </section>

        {/* Held at the bottom: on a short window the popover scrolls, and the
            buttons went out of sight with the text above them. */}
        <footer className="sticky bottom-0 flex items-center gap-2 border-t border-line-soft bg-surface-2 px-3 py-2">
          <Action id="newDeviceLink" label="New Link…" className="-ml-2 mr-auto" />
          <Action id="stopDeviceServer" label="Stop" tone="secondary" />
          <Action id="launchOnDevices" label="Launch" tone="primary" />
        </footer>
      </div>
    </Popover>
  );
}
