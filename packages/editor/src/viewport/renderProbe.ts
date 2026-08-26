import { Vector2 } from 'three/webgpu';
import type { Texture, WebGPURenderer } from 'three/webgpu';

/**
 * Measurement scaffolding for `Destroyed texture … used in a submit`.
 *
 * The error names a texture and a size and nothing else, and the two readings
 * that fit it are opposites: either the drawing buffer really changed and the
 * destroy was legitimate but badly timed, or the texture was destroyed and
 * rebuilt at the *same* size, in which case `WebGPUBackend._getRenderPassDescriptor`
 * is holding a view of something that no longer exists. Its descriptor cache is
 * keyed on `width/height/samples` alone, so a same-size rebuild slips straight
 * past it.
 *
 * Reading the code cannot separate those two. Commit d3169da is the standing
 * reminder of why — the obvious reading there was wrong, and only counting said
 * so: 301 errors before the "fix", 301 after. So this counts.
 *
 * Two ways in. From the devtools console, on a run already going:
 *
 * ```js
 * __studioRenderProbe.arm()
 * __studioRenderProbe.mark()          // start a window
 * __studioRenderProbe.report()        // errors/second, and the last events
 * ```
 *
 * Or set `localStorage.setItem('studio.probe.render', '1')` and reload, which
 * arms it before the first frame. The late path exists because the smoke harness
 * only gets to run script after the page has loaded, and wrapping
 * `backend.destroyTexture` is just as valid on frame 900 as on frame 1.
 *
 * Per-event lines go to `console.debug`, which `consoleStore` does not capture:
 * the editor's own Console panel keeps a 500-entry ring and folds repeats, so a
 * chatty probe would evict the very errors it is here to count. They still reach
 * the terminal through the `console-message` mirror in `windows.ts` as
 * `[renderer:debug]`.
 *
 * **This file is scaffolding.** It comes out with the fix, or stays behind its
 * flag with a line in the commit message saying so.
 */

const FLAG = 'studio.probe.render';

/** What the count is looking for, and what the probe's own lines must not say. */
const PATTERN = 'Destroyed texture';

/**
 * A tail to read after the fact, not a transcript — but it has to be long
 * enough to hold one whole frame's passes plus the error that follows them.
 * A shadowed scene encodes a pass per light per frame.
 */
const MAX_EVENTS = 600;

interface ProbeEvent {
  frame: number;
  kind: 'size' | 'resize' | 'destroy' | 'error' | 'begin' | 'finish' | 'scope';
  text: string;
}

/**
 * Enough of the WebGPU backend and of `Textures` to ask the two questions that
 * matter. Neither is public API — `backend` is typed as the abstract base, and
 * `_textures` is private — so both are reached through a narrow local shape
 * rather than a bare `any`.
 */
interface RenderContextLike {
  id: number;
  renderTarget: RenderTargetLike | null;
}

interface RenderTargetLike {
  width?: number;
  height?: number;
  texture?: Texture;
}

/** What the backend's `DataMap` holds for a render target and for a texture. */
interface BackendData {
  width?: number;
  height?: number;
  descriptors?: Record<string, unknown>;
  texture?: { width: number; height: number };
  msaaTexture?: { width: number; height: number };
}

/**
 * Just enough of `GPUDevice` to bracket a pass in an error scope.
 *
 * Declared locally rather than pulled from `@webgpu/types`: the package is not a
 * dependency, and this needs two methods.
 */
interface DeviceLike {
  pushErrorScope: (filter: string) => void;
  popErrorScope: () => Promise<{ message: string } | null>;
}

interface BackendLike {
  destroyTexture: (texture: Texture, isDefaultTexture?: boolean) => void;
  beginRender: (renderContext: RenderContextLike) => void;
  finishRender: (renderContext: RenderContextLike) => void;
  device?: DeviceLike;
  get: (object: unknown) => BackendData;
}

interface TexturesLike {
  get: (texture: Texture) => { version?: number } | undefined;
}

interface RendererInternals {
  backend: BackendLike;
  _textures: TexturesLike | null;
  _frameBufferTargets: Map<unknown, { texture?: Texture }>;
}

let armed = false;
let target: RendererInternals | null = null;

/**
 * The ring as it stood the first time the error fired.
 *
 * Kept separately because the ring keeps moving: by the time anyone asks, the
 * frames around the first failure are long gone. The first one is the one worth
 * having — later ones are the same story repeated.
 */
let firstErrorContext: ProbeEvent[] | null = null;

let frame = 0;
let events: ProbeEvent[] = [];
let errorCount = 0;
let markedAt = 0;
let markedCount = 0;

/** The frame a size change was last seen on — the whole point of the exercise. */
let sizeChangedOnFrame = -1;
/** How many render passes are encoded but not yet submitted. */
let open = 0;
let lastBuffer = '';
let lastClient = '';

const scratch = new Vector2();

/** Whether the flag was set before this run started. */
function flagged(): boolean {
  try {
    return localStorage.getItem(FLAG) === '1';
  } catch {
    // Storage can be denied outright. A probe that throws on startup would be
    // worse than a probe that stays off.
    return false;
  }
}

function push(kind: ProbeEvent['kind'], text: string): void {
  events.push({ frame, kind, text });
  if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);
  // Pass boundaries stay in the ring only. They are several per frame, and
  // writing them out would cost more than the thing being measured — the point
  // is their order relative to a destroy, which the ring preserves.
  if (kind === 'begin' || kind === 'finish') return;
  console.debug(`[probe:${frame}] ${kind} ${text}`);
}

/**
 * Publishes the handle, and arms straight away if the flag was already set.
 *
 * Call once, right after the renderer exists. In a production build the whole
 * body is dropped by the `import.meta.env` guard.
 */
export function installRenderProbe(renderer: WebGPURenderer): void {
  if (!import.meta.env.DEV) return;

  target = renderer as unknown as RendererInternals;

  (globalThis as unknown as Record<string, unknown>)['__studioRenderProbe'] = {
    arm,
    mark,
    report,
    events: () => events,
    firstError: () => firstErrorContext,
  };

  if (flagged()) arm();
}

/**
 * Starts watching. Idempotent, and safe at any point in a run.
 *
 * Everything it hooks is a wrapper over a live method — nothing is captured at
 * construction — so arming late loses only the frames before the call.
 */
function arm(): void {
  if (armed || !target) return;
  armed = true;

  const backend = target.backend;
  const destroyTexture = backend.destroyTexture.bind(backend);
  const internals = target;

  backend.destroyTexture = (texture: Texture, isDefaultTexture?: boolean) => {
    reportDestroy(internals, texture);
    destroyTexture(texture, isDefaultTexture);
  };

  // The pass boundaries, so a destroy can be placed *inside* an open pass rather
  // than merely on the same frame as one. That is the whole difference between
  // "the destroy was legitimate" and "the destroy retired a texture the open
  // command buffer still points at".
  const beginRender = backend.beginRender.bind(backend);
  const finishRender = backend.finishRender.bind(backend);

  // An error scope per pass. `Uncaptured` errors arrive on a later task — the
  // first trace put one four frames after the destroy it was about — which makes
  // them useless for saying *which* submit was invalid. A scope is popped by the
  // pass that pushed it, and nested passes nest correctly, so this attributes
  // the failure exactly. Capturing the error also means three's uncaptured
  // handler no longer sees it, which is why the count comes from here while
  // scopes are on.
  const device = backend.device;

  backend.beginRender = (renderContext: RenderContextLike) => {
    open += 1;
    push('begin', `ctx=${renderContext.id} ${describeTarget(backend, renderContext)} open=${open}`);
    device?.pushErrorScope('validation');
    beginRender(renderContext);
  };
  backend.finishRender = (renderContext: RenderContextLike) => {
    finishRender(renderContext);
    const id = renderContext.id;
    const at = frame;
    if (device) {
      void device.popErrorScope().then((error) => {
        if (!error) return;
        errorCount += 1;
        const text = `ctx=${id} frame=${at} ${error.message.split('\n')[0]}`;
        events.push({ frame: at, kind: 'scope', text });
        if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);
        firstErrorContext ??= events.slice(-120);
      });
    }
    open -= 1;
    push('finish', `ctx=${id} open=${open}`);
  };

  countErrors();

  console.debug('[probe] render probe armed');
}

/**
 * Every render-target texture that is destroyed, with both version numbers.
 *
 * `texVer` is what three thinks the texture is at; `dataVer` is what the GPU
 * copy was built from. d3169da traced the two-renderer case with exactly this
 * pair — 4/3, then 5/4, then 6/5, every frame — and a permanent lag of one is
 * the signature of a destroy-and-rebuild happening once per frame.
 *
 * Model and material textures are skipped. A scene that is streaming in retires
 * dozens a second, and they would bury the handful of lines that matter.
 */
function reportDestroy(internals: RendererInternals, texture: Texture): void {
  const isTarget =
    (texture as { isRenderTargetTexture?: boolean }).isRenderTargetTexture === true ||
    (texture as { isDepthTexture?: boolean }).isDepthTexture === true;
  if (!isTarget) return;

  const image = texture.image as { width?: number; height?: number } | undefined;
  const data = internals._textures?.get(texture);
  // The question the whole probe exists to answer: was this destroy the
  // consequence of a size change, or did it land on a frame where nothing moved?
  const sameFrame = sizeChangedOnFrame === frame;
  // Which target this belongs to. Shadow maps and the sky's PMREM capture are
  // render targets too, and they are retired for perfectly ordinary reasons —
  // only the tone-mapping target is the one named in the error.
  const which = isFrameBufferTarget(internals, texture) ? 'frameBufferTarget' : 'other';

  push(
    'destroy',
    `${which} ${image?.width ?? '?'}x${image?.height ?? '?'} texVer=${texture.version} ` +
      `dataVer=${data?.version ?? '-'} sizeChangedThisFrame=${sameFrame} openPasses=${open}`,
  );
}

/**
 * What the pass is about to draw into, as three sees it *and* as the GPU has it.
 *
 * Three numbers that should always agree, and the bug is exactly the case where
 * they do not: `rt` is the JS render target, `rtData` is what the backend cached
 * its descriptors against, and `gpu` is the size of the texture object those
 * descriptors actually hold a view of. A `gpu` lagging the other two is a view
 * of something that has been destroyed.
 */
function describeTarget(backend: BackendLike, renderContext: RenderContextLike): string {
  const rt = renderContext.renderTarget;
  if (!rt) return 'canvas';

  const rtData = backend.get(rt);
  const texData = rt.texture ? backend.get(rt.texture) : undefined;
  const gpu = texData?.texture;
  const msaa = texData?.msaaTexture;

  return (
    `rt=${rt.width ?? '?'}x${rt.height ?? '?'} ` +
    `rtData=${rtData.width ?? '-'}x${rtData.height ?? '-'} ` +
    `gpu=${gpu ? `${gpu.width}x${gpu.height}` : '-'} ` +
    `msaa=${msaa ? `${msaa.width}x${msaa.height}` : '-'} ` +
    `descriptors=${rtData.descriptors ? Object.keys(rtData.descriptors).length : '-'}`
  );
}

/** Whether this texture is the colour attachment of three's tone-mapping target. */
function isFrameBufferTarget(internals: RendererInternals, texture: Texture): boolean {
  const targets = internals._frameBufferTargets;
  if (!targets) return false;
  for (const target of targets.values()) {
    if (target.texture === texture) return true;
  }
  return false;
}

/**
 * Per-frame size watch. Call at the top of the frame loop.
 *
 * Silent while nothing moves, which is what makes the lines it does write worth
 * reading.
 */
export function probeFrame(renderer: WebGPURenderer, container: HTMLElement | null): void {
  if (!armed) return;

  frame += 1;

  renderer.getDrawingBufferSize(scratch);
  const buffer = `${scratch.x}x${scratch.y}`;
  const client = container ? `${container.clientWidth}x${container.clientHeight}` : 'detached';

  if (buffer === lastBuffer && client === lastClient) return;

  push('size', `buffer=${buffer} (was ${lastBuffer || '-'}) client=${client} (was ${lastClient || '-'})`);
  lastBuffer = buffer;
  lastClient = client;
  sizeChangedOnFrame = frame;
}

/** Every call to `EditorViewport.resize`, whether or not it changed anything. */
export function probeResize(width: number, height: number, changed: boolean): void {
  if (!armed) return;
  push('resize', `${width}x${height} ${changed ? 'CHANGED' : 'same'}`);
}

/**
 * Counts the errors, independently of the editor's Console panel.
 *
 * `consoleStore` folds consecutive identical messages into one row with a
 * counter and keeps only the last 500, so reading a number back out of it means
 * trusting a ring buffer that anything else on the page can evict. Chaining
 * `console.error` here is exact, and works whichever side of `captureConsole`
 * it is installed on — both delegate.
 */
function countErrors(): void {
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes(PATTERN))) {
      errorCount += 1;
      // Not through `push`: this runs inside `console.error`, and writing a
      // console line from it is one loop away from being its own problem.
      events.push({ frame, kind: 'error', text: PATTERN });
      if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);
      firstErrorContext ??= events.slice(-120);
    }
    original(...args);
  };
}

/** Opens a measurement window. */
function mark(): void {
  markedAt = performance.now();
  markedCount = errorCount;
  console.log('[probe] marked — fly, drag, then call __studioRenderProbe.report()');
}

/** Closes it, in errors per second so two runs of different lengths compare. */
function report(): { seconds: number; errors: number; perSecond: number } {
  const seconds = markedAt === 0 ? 0 : (performance.now() - markedAt) / 1000;
  const errors = errorCount - markedCount;
  const perSecond = seconds === 0 ? 0 : errors / seconds;

  console.log(
    `[probe] ${errors} errors in ${seconds.toFixed(1)}s (${perSecond.toFixed(2)}/s), ` +
      `${events.length} events held`,
  );
  for (const event of events.slice(-40)) {
    console.log(`[probe:${event.frame}] ${event.kind} ${event.text}`);
  }

  return { seconds, errors, perSecond };
}
