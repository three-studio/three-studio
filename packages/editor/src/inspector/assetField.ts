import { createId, hasImagePreview, type AssetEntry, type AssetKind } from '@three-studio/core';
import {
  VERSION as CORE_VERSION,
  type BaseInputParams,
  type InputBindingPlugin,
  type TpPluginBundle,
  type Value,
  type ValueController,
  type View,
  type ViewProps,
} from '@tweakpane/core';
import { ASSET_DRAG_MIME, assetKindMime } from '../assets/assetDrag';
import { showPanel } from '../shell/dockApi';
import { browseAndImport } from '../import/importStore';
import { useAssetStore } from '../state/assetStore';
import { useOverlayStore } from '../state/overlayStore';

/**
 * A Tweakpane control for referencing a project asset.
 *
 * Tweakpane has no image input. The community plugin
 * (`@kitschpatrol/tweakpane-plugin-image`) does work with Tweakpane 4 and can
 * bind a string, but the string it writes is a URL for the file the user
 * picked — a data or object URL, straight off the filesystem. Our document
 * stores an asset id instead, so that it stays small, serialisable and
 * portable to the web export, and so the file goes through the import pipeline
 * that gives it a sidecar, an id and a content hash. Hence this control: the
 * picker imports first and assigns the resulting id. The file becomes an asset
 * before it becomes a reference.
 *
 *     ▣  Bamboo_Color            ⭳  ◎  ✕
 *
 * The whole row is also a drop target for an asset dragged out of the Project
 * panel.
 *     │  │                       │  │  └ clear
 *     │  │                       │  └ reveal in the Project panel
 *     │  │                       └ import a new file and assign it
 *     │  └ name; opens a searchable picker
 *     └ thumbnail; hover for a larger preview
 */

export interface AssetFieldParams extends BaseInputParams {
  view: 'asset';
  assetKind: AssetKind;
  /**
   * What the empty value is called, where "None" would be a lie.
   *
   * A mesh with no material asset draws its own embedded one; a model with none
   * draws the materials its file shipped with. Both are a *choice* rather than
   * an absence, and calling either "None" reads as "this object has no
   * material", which is the opposite of what is on screen.
   */
  emptyLabel?: string;
}

/** Empty selection. `null` in the document; a primitive here, as the DOM needs. */
const NONE = '';

const PREVIEW_DELAY_MS = 1000;
const PREVIEW_SIZE = 128;

function isAssetFieldParams(params: Record<string, unknown>): params is AssetFieldParams {
  return params['view'] === 'asset' && typeof params['assetKind'] === 'string';
}

function assetUrl(entry: AssetEntry): string {
  return `studio-asset://project/${entry.path.split('/').map(encodeURIComponent).join('/')}`;
}

/** lucide paths, inlined because this control is plain DOM rather than React. */
const ICONS = {
  import: ['M12 3v12', 'm8 11 4 4 4-4', 'M8 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4'],
  locate: ['M22 12h-4', 'M6 12H2', 'M12 6V2', 'M12 22v-4'],
  clear: ['M18 6 6 18', 'm6 6 12 12'],
};

function iconButton(document: Document, name: keyof typeof ICONS, title: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.title = title;
  button.classList.add('tp-btnv_b');
  button.style.cssText =
    'flex:0 0 auto;width:22px;height:20px;padding:0;display:flex;align-items:center;justify-content:center;';

  // lucide's crosshair: the ticks stop where the circle begins, so r must
  // match them or the glyph reads as a diamond at 12px.
  const circle = name === 'locate' ? '<circle cx="12" cy="12" r="10"/>' : '';
  button.innerHTML =
    `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${circle}` +
    ICONS[name].map((d) => `<path d="${d}"/>`).join('') +
    `</svg>`;
  return button;
}

/**
 * Larger preview shown after hovering the thumbnail.
 *
 * Appended to `document.body`: `position: fixed` is relative to the viewport
 * only while no ancestor has a transform, and dockview positions its panels
 * with one — the same trap the context menu fell into. Capped on both axes so
 * a non-square texture keeps its proportions.
 */
class PreviewTooltip {
  private element: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  scheduleFor(anchor: HTMLElement, url: string): void {
    this.cancel();
    this.timer = setTimeout(() => this.show(anchor, url), PREVIEW_DELAY_MS);
  }

  cancel(): void {
    clearTimeout(this.timer);
    this.element?.remove();
    this.element = null;
  }

  private show(anchor: HTMLElement, url: string): void {
    const element = document.createElement('div');
    element.className = 'studio-asset-preview';
    element.style.cssText =
      'position:fixed;z-index:var(--z-index-menu);padding:4px;border:1px solid var(--color-line-soft);' +
      'border-radius:4px;background:var(--color-surface-0);' +
      'box-shadow:0 8px 24px rgba(0,0,0,.5);pointer-events:none;';

    const image = document.createElement('img');
    image.src = url;
    image.style.cssText = `display:block;max-width:${PREVIEW_SIZE}px;max-height:${PREVIEW_SIZE}px;`;
    element.appendChild(image);

    document.body.appendChild(element);
    this.element = element;

    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      // Above by default; below only when there is not enough room, so it
      // never covers the row the pointer is on unless it has to.
      const above = rect.top - box.height - 6;
      element.style.top = `${above >= 0 ? above : rect.bottom + 6}px`;
      element.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - box.width - 4))}px`;
    };

    place();
    // The image decides the box size, so place again once it has loaded.
    image.addEventListener('load', place, { once: true });
  }
}

/** Searchable list of assets, opened from the name button. */
class AssetPicker {
  private element: HTMLElement | null = null;

  open(
    anchor: HTMLElement,
    kind: AssetKind,
    emptyLabel: string,
    current: string,
    onPick: (id: string) => void,
  ): void {
    this.close();

    const element = document.createElement('div');
    element.style.cssText =
      'position:fixed;z-index:var(--z-index-menu);width:240px;max-height:280px;display:flex;flex-direction:column;' +
      'border:1px solid var(--color-line-soft);border-radius:4px;background:var(--color-surface-2);' +
      'box-shadow:0 8px 24px rgba(0,0,0,.5);overflow:hidden;';

    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search';
    search.style.cssText =
      'flex:0 0 auto;padding:6px 8px;border:0;border-bottom:1px solid var(--color-line-soft);' +
      'background:var(--color-surface-0);color:var(--color-ink);font:inherit;outline:none;';
    element.appendChild(search);

    const list = document.createElement('div');
    list.style.cssText = 'flex:1 1 auto;overflow-y:auto;';
    element.appendChild(list);

    const assets = useAssetStore.getState().byKind(kind);
    const render = () => {
      const needle = search.value.trim().toLowerCase();
      const matches = assets.filter((asset) => asset.name.toLowerCase().includes(needle));
      list.replaceChildren();

      const addRow = (label: string, id: string, entry?: AssetEntry) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.style.cssText =
          'display:flex;align-items:center;gap:6px;width:100%;padding:4px 8px;border:0;text-align:left;' +
          `background:${id === current ? 'var(--color-accent-dim)' : 'transparent'};` +
          'color:var(--color-ink);font:inherit;cursor:pointer;';
        row.addEventListener('mouseenter', () => {
          if (id !== current) row.style.background = 'var(--color-surface-3)';
        });
        row.addEventListener('mouseleave', () => {
          row.style.background = id === current ? 'var(--color-accent-dim)' : 'transparent';
        });

        if (kind === 'texture') {
          // The slot is kept for every texture row, even one that cannot draw
          // itself: giving it only to some leaves the names in a ragged column.
          const thumb = document.createElement('div');
          thumb.style.cssText =
            'width:18px;height:18px;flex:0 0 auto;border-radius:2px;background:var(--color-surface-0);' +
            'background-size:cover;background-position:center;';
          if (entry && hasImagePreview(entry)) {
            thumb.style.backgroundImage = `url("${assetUrl(entry)}")`;
          }
          row.appendChild(thumb);
        }

        const name = document.createElement('span');
        name.textContent = label;
        name.style.cssText = 'flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        row.appendChild(name);

        row.addEventListener('click', () => {
          onPick(id);
          this.close();
        });
        list.appendChild(row);
      };

      addRow(emptyLabel, NONE);
      for (const asset of matches) addRow(asset.name, asset.id, asset);
    };

    search.addEventListener('input', render);
    render();

    document.body.appendChild(element);
    this.element = element;

    const rect = anchor.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    element.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - box.height - 4)}px`;
    element.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - box.width - 4))}px`;

    const dismiss = (event: PointerEvent) => {
      if (!element.contains(event.target as Node)) this.close();
    };
    // Captured, so the menu closes before the click lands behind it.
    document.addEventListener('pointerdown', dismiss, true);

    // Registered by hand rather than through `useOverlay`: this control is
    // plain DOM, because Tweakpane is. Escape comes back through `close` from
    // the stack, and — the reason this matters at all — the editor's shortcuts
    // stop firing while the picker has the keyboard.
    const overlayId = `asset-picker:${createId()}`;
    useOverlayStore.getState().open({
      id: overlayId,
      kind: 'popover',
      close: () => this.close(),
    });

    this.teardown = () => {
      document.removeEventListener('pointerdown', dismiss, true);
      useOverlayStore.getState().close(overlayId);
    };

    search.focus({ preventScroll: true });
  }

  close(): void {
    this.teardown?.();
    this.teardown = undefined;
    this.element?.remove();
    this.element = null;
  }

  private teardown: (() => void) | undefined;
}

class AssetFieldView implements View {
  readonly element: HTMLElement;
  readonly name: HTMLButtonElement;
  readonly browse: HTMLButtonElement;
  readonly locate: HTMLButtonElement;
  readonly clear: HTMLButtonElement;
  readonly preview: HTMLElement;
  private readonly kind: AssetKind;
  private readonly tooltip = new PreviewTooltip();

  constructor(
    document: Document,
    kind: AssetKind,
    private readonly emptyLabel: string,
    viewProps: ViewProps,
  ) {
    this.kind = kind;

    this.element = document.createElement('div');
    this.element.classList.add('tp-asset');
    this.element.style.cssText = 'display:flex;align-items:center;gap:3px;';

    // Only textures have something to show. For other kinds the name is the
    // whole story, so the space goes back to the label.
    this.preview = document.createElement('div');
    this.preview.style.cssText =
      'width:20px;height:20px;flex:0 0 auto;border-radius:2px;' +
      'background-size:cover;background-position:center;background-color:var(--in-bg);';
    if (kind === 'texture') this.element.appendChild(this.preview);

    // A name, not a dropdown: a list of three hundred textures is unusable,
    // and the picker it opens has a search box.
    this.name = document.createElement('button');
    this.name.type = 'button';
    this.name.classList.add('tp-txtv_i');
    this.name.style.cssText =
      'flex:1 1 auto;min-width:0;height:20px;padding:0 6px;text-align:left;' +
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;';
    this.element.appendChild(this.name);

    this.browse = iconButton(document, 'import', `Import a ${kind} and assign it`);
    this.locate = iconButton(document, 'locate', 'Show in the Project panel');
    this.clear = iconButton(document, 'clear', 'Clear');
    this.element.append(this.browse, this.locate, this.clear);

    for (const control of [this.name, this.browse, this.locate, this.clear]) {
      viewProps.bindDisabled(control);
    }
  }

  render(assetId: string): void {
    const entry = useAssetStore.getState().byId(assetId);
    const empty = assetId === NONE;

    this.name.textContent = empty ? this.emptyLabel : (entry?.name ?? '(missing)');
    // A reference whose file is gone must look wrong rather than look empty:
    // reading as "None" would drop it on the next edit without a word.
    this.name.style.color = !empty && !entry ? '#e0704f' : '';

    const url = entry && hasImagePreview(entry) ? assetUrl(entry) : null;
    this.preview.style.backgroundImage = url === null ? '' : `url("${url}")`;
    this.preview.style.cursor = url === null ? '' : 'zoom-in';

    this.locate.disabled = entry === undefined;
    this.clear.disabled = empty;
    for (const control of [this.locate, this.clear]) {
      control.style.opacity = control.disabled ? '0.35' : '';
    }

    this.tooltip.cancel();
    this.preview.onpointerenter = url === null ? null : () => this.tooltip.scheduleFor(this.preview, url);
    this.preview.onpointerleave = () => this.tooltip.cancel();
  }

  /** Highlights the whole row, which is the drop target, not just the thumbnail. */
  setDropTarget(active: boolean): void {
    this.element.style.outline = active ? '1px solid var(--tp-in-fg, #7ea6ff)' : '';
    this.element.style.outlineOffset = active ? '1px' : '';
    this.element.style.borderRadius = active ? '3px' : '';
  }

  dispose(): void {
    this.tooltip.cancel();
  }
}

class AssetFieldController implements ValueController<string, AssetFieldView> {
  readonly value: Value<string>;
  readonly view: AssetFieldView;
  readonly viewProps: ViewProps;
  private readonly kind: AssetKind;
  private readonly emptyLabel: string;
  private readonly picker = new AssetPicker();

  constructor(
    document: Document,
    config: {
      value: Value<string>;
      viewProps: ViewProps;
      kind: AssetKind;
      emptyLabel: string;
    },
  ) {
    this.value = config.value;
    this.viewProps = config.viewProps;
    this.kind = config.kind;
    this.emptyLabel = config.emptyLabel;
    this.view = new AssetFieldView(document, config.kind, config.emptyLabel, config.viewProps);

    this.view.name.addEventListener('click', () => {
      this.picker.open(this.view.element, this.kind, this.emptyLabel, this.value.rawValue, (id) => {
        this.value.rawValue = id;
      });
    });
    this.view.browse.addEventListener('click', () => void this.importAndAssign());
    this.view.locate.addEventListener('click', () => this.revealInProject());
    this.view.clear.addEventListener('click', () => {
      this.value.rawValue = NONE;
    });

    this.bindDropTarget();

    this.viewProps.handleDispose(() => {
      this.picker.close();
      this.view.dispose();
    });

    this.value.emitter.on('change', () => this.view.render(this.value.rawValue));
    this.view.render(this.value.rawValue);
  }

  /**
   * Accepts an asset dragged out of the Project panel.
   *
   * The kind is checked from the type name rather than the payload: during
   * `dragover` the browser exposes `dataTransfer.types` but withholds the data,
   * so a slot could not otherwise tell a texture from a model until the drop
   * had already happened — and a target that lights up for anything and then
   * refuses is worse than one that never lit up.
   */
  private bindDropTarget(): void {
    const element = this.view.element;
    const accepts = (event: DragEvent) =>
      event.dataTransfer?.types.includes(assetKindMime(this.kind)) ?? false;

    element.addEventListener('dragover', (event) => {
      if (!accepts(event)) return;
      // Only preventDefault on something we accept: leaving it alone is what
      // makes the cursor show "no drop" for the wrong kind.
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      this.view.setDropTarget(true);
    });

    element.addEventListener('dragleave', (event) => {
      // Moving between the row's own children fires dragleave; ignore those.
      if (element.contains(event.relatedTarget as Node)) return;
      this.view.setDropTarget(false);
    });

    element.addEventListener('drop', (event) => {
      if (!accepts(event)) return;
      event.preventDefault();
      event.stopPropagation();
      this.view.setDropTarget(false);

      const assetId = event.dataTransfer?.getData(ASSET_DRAG_MIME) ?? '';
      if (assetId !== '') this.value.rawValue = assetId;
    });
  }

  /**
   * Opens the import dialog, then assigns the first thing that came back.
   *
   * The same dialog the Project panel opens, so a texture imported from a
   * material slot gets the same colour-space question as one dropped into the
   * browser. It resolves with what was imported, which is why this slot can
   * fill itself — the store refresh it does on the way is already done by then.
   */
  private async importAndAssign(): Promise<void> {
    const result = await browseAndImport();
    // Cancelled, or nothing importable was picked.
    if (result === null) return;

    // The first of what the author chose. Assigning several is a question the
    // slot cannot answer — it holds one asset.
    const imported = result.imported.find((asset) => asset.kind === this.kind);
    if (imported) this.value.rawValue = imported.id;
  }

  /** Points the Project panel at the folder holding this asset. */
  private revealInProject(): void {
    const entry = useAssetStore.getState().byId(this.value.rawValue);
    if (!entry) return;

    const store = useAssetStore.getState();
    store.setFolder(entry.folder);
    // A leftover search or kind filter would hide the asset we just navigated
    // to, which reads as the button having done nothing.
    store.setQuery('');
    store.setKindFilter('all');
    showPanel('project');
  }
}

const assetFieldPlugin: InputBindingPlugin<string, string, AssetFieldParams> = {
  id: 'input-studio-asset',
  type: 'input',
  // Optional in the type, required at runtime: registration compares this
  // against the *core* version and rejects a mismatch, which then throws out of
  // the inspector's render. It must be `@tweakpane/core`'s version (2.x), not
  // tweakpane's own (4.x) — those differ, and using the wrong one fails exactly
  // as declaring nothing does.
  core: CORE_VERSION,

  accept(exValue, params) {
    if (typeof exValue !== 'string') return null;
    if (!isAssetFieldParams(params)) return null;
    return { initialValue: exValue, params };
  },

  binding: {
    reader: () => (value) => (typeof value === 'string' ? value : NONE),
    writer: () => (target, value) => target.write(value),
  },

  controller: (args) =>
    new AssetFieldController(args.document, {
      value: args.value,
      viewProps: args.viewProps,
      kind: args.params.assetKind,
      emptyLabel:
        args.params.emptyLabel ?? (args.params.assetKind === 'material' ? 'Embedded' : 'None'),
    }),
};

export const assetFieldBundle: TpPluginBundle = {
  id: 'studio-asset',
  plugins: [assetFieldPlugin],
};
