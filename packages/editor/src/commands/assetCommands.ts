import {
  FORBIDDEN_FILE_NAME_CHARS,
  findAssetUsage,
  isUsed,
  totalUses,
  type AssetEntry,
} from '@three-studio/core';
import { showPanel } from '../shell/dockApi';
import { defineCommand } from './command';
import { askForText, askToConfirm } from '../state/dialogStore';
import { useAssetStore } from '../state/assetStore';
import { useDocumentStore } from '../state/documentStore';
import { notify } from '../state/toastStore';

/**
 * Points the Project panel at an asset and brings it to the front.
 *
 * A gesture rather than a method on the control that offers it: the asset slot
 * in the Inspector is a Tweakpane plugin, and a declarative field table has no
 * business driving the dock. It asks for this by name and is handed it.
 *
 * Not exported: the command below is the only way in. Leaving the function
 * public as well would be the second door the registry exists to close — a
 * caller that reaches past `can()` is exactly the divergence that started all
 * this.
 */
function revealAsset(assetId: string): void {
  const store = useAssetStore.getState();
  const entry = store.byId(assetId);
  if (!entry) return;

  store.setFolder(entry.folder);
  // A leftover search or kind filter would hide the asset we just navigated to,
  // which reads as the button having done nothing.
  store.setQuery('');
  store.setKindFilter('all');
  showPanel('project');
}

/**
 * Deletes an asset, after saying what it would take with it.
 *
 * The file leaves the project and no amount of Cmd+Z brings it back, so this is
 * the one operation that has to ask. Unity refuses outright when something
 * references an asset; asking instead is the middle ground — sometimes deleting
 * a used asset is exactly the intent, and an editor that only says no makes you
 * go around it in Finder.
 *
 * Not exported, for the reason `revealAsset` is not: one door.
 */
async function deleteAsset(asset: AssetEntry): Promise<void> {
  const store = useAssetStore.getState();
  const usage = findAssetUsage(
    asset.id,
    useDocumentStore.getState().scene,
    store.materials,
    store.prefabs,
  );

  const details = describe(usage);
  const confirmed = await askToConfirm({
    title: `Delete "${asset.name}"?`,
    message: isUsed(usage)
      ? `${totalUses(usage)} thing${totalUses(usage) === 1 ? '' : 's'} in this project use it. They will keep the reference and show nothing.`
      : 'Nothing in the open scene uses it. Other scenes have not been read, so this is about what is loaded now.',
    details,
    confirmLabel: 'Delete',
    destructive: true,
  });
  if (!confirmed) return;

  await store.remove(asset.path);
  notify({ kind: 'success', title: `Deleted "${asset.name}"` });
}

/*
 * The three folder gestures below stay functions, and the reason is structural
 * rather than a matter of taste.
 *
 * `Command.run` re-checks `can()` and returns early when it refuses. A refusal
 * has no value to hand back, so `run` cannot return one — and all three of these
 * return something a caller depends on: `DestinationBrowser` navigates into the
 * folder that was created (whose name may have been suffixed on collision),
 * follows the one that was renamed, and leaves the one that was deleted. Making
 * them commands would either drop that or force `run` to return `unknown` for
 * every command in the editor to serve one caller.
 *
 * So the line "no gesture called from React without going through the registry"
 * has an edge, and this is where it is: **a gesture whose result a caller reads
 * is a function call, not a command**. A command is something a person asked
 * for, dispatched by a menu, a key or a palette — none of which is in a position
 * to do anything with a return value.
 *
 * Recorded in `RESTES.md`, because a command palette (milestone 8.4) would
 * plausibly want "New Folder", and that is the day to reopen it.
 */

/** Everything under a folder, itself included. */
function subtreeOf(path: string): { assets: AssetEntry[]; folders: string[] } {
  const manifest = useAssetStore.getState().manifest;
  const prefix = `${path}/`;
  return {
    assets: manifest.assets.filter(
      (asset) => asset.folder === path || asset.folder.startsWith(prefix),
    ),
    folders: manifest.folders.filter((folder) => folder.startsWith(prefix)),
  };
}

/**
 * Renames a folder, asking first when it is not empty.
 *
 * The assets themselves are safe — an id lives in the sidecar beside its file
 * and the whole directory moves at once — but anything that wrote the path down
 * outside the editor is not, and the author is the only one who knows whether
 * something did.
 */
export async function renameFolder(path: string): Promise<string | null> {
  const current = path.split('/').pop() ?? path;

  const name = await askForText({
    title: `Rename "${current}"`,
    label: 'Name',
    defaultValue: current,
    confirmLabel: 'Rename',
    validate: (value) =>
      value.trim() === ''
        ? 'A folder needs a name.'
        : FORBIDDEN_FILE_NAME_CHARS.test(value)
          ? 'A folder name cannot contain / \\ : * ? " < > | or a control character'
          : null,
  });
  if (name === null || name.trim() === current) return null;

  const { assets } = subtreeOf(path);
  if (assets.length > 0) {
    const confirmed = await askToConfirm({
      title: `Rename "${current}"?`,
      message: `It holds ${assets.length} asset${assets.length === 1 ? '' : 's'}. Scenes reference assets by id, not by path, so none of them break — but anything outside the editor pointing at these files will.`,
      details: assets.slice(0, 12).map((asset) => `${asset.kind} · ${asset.name}`),
      confirmLabel: 'Rename',
    });
    if (!confirmed) return null;
  }

  const renamed = await useAssetStore.getState().renameFolder(path, name.trim());
  if (renamed === null) return null;
  notify({ kind: 'success', title: `Renamed to "${renamed.split('/').pop()}"` });
  return renamed;
}

/**
 * Deletes a folder, and only ever an empty one.
 *
 * Deleting assets destroys the ids every scene reference is made of, so a
 * folder with anything in it is emptied first, one asset at a time, where
 * `deleteAsset` can report what each one would take with it.
 */
export async function deleteFolder(path: string): Promise<boolean> {
  const name = path.split('/').pop() ?? path;
  const { assets, folders } = subtreeOf(path);

  if (assets.length > 0 || folders.length > 0) {
    const holds = [
      assets.length > 0 && `${assets.length} asset${assets.length === 1 ? '' : 's'}`,
      folders.length > 0 && `${folders.length} folder${folders.length === 1 ? '' : 's'}`,
    ].filter((part): part is string => part !== false);

    await askToConfirm({
      title: `"${name}" is not empty`,
      message: `It holds ${holds.join(' and ')}. Only an empty folder can be deleted here — delete what is inside first, so each asset can tell you what it would take with it.`,
      details: [
        ...folders.slice(0, 6).map((folder) => `Folder · ${folder.split('/').pop()}`),
        ...assets.slice(0, 12).map((asset) => `${asset.kind} · ${asset.name}`),
      ],
      confirmLabel: 'OK',
    });
    return false;
  }

  const confirmed = await askToConfirm({
    title: `Delete "${name}"?`,
    message: 'The folder is empty, so nothing is lost.',
    confirmLabel: 'Delete',
    destructive: true,
  });
  if (!confirmed) return false;

  await useAssetStore.getState().removeFolder(path);
  if (useAssetStore.getState().manifest.folders.includes(path)) return false;
  notify({ kind: 'success', title: `Deleted "${name}"` });
  return true;
}

/**
 * Creates a folder inside `parent`, returning the path it actually got.
 *
 * Returns the created path rather than the requested one because the name is
 * suffixed on collision — navigating into what was asked for lands nowhere.
 */
export async function createFolder(parent: string): Promise<string | null> {
  const name = await askForText({
    title: 'New Folder',
    label: 'Name',
    defaultValue: 'New Folder',
    confirmLabel: 'Create',
    validate: (value) =>
      value.trim() === ''
        ? 'A folder needs a name.'
        : FORBIDDEN_FILE_NAME_CHARS.test(value)
          ? 'A folder name cannot contain / \\ : * ? " < > | or a control character'
          : null,
  });
  if (name === null) return null;

  const wanted = parent === '' ? name.trim() : `${parent}/${name.trim()}`;
  return useAssetStore.getState().createFolder(wanted);
}

/** One readable line per user, capped: a wall of ids helps nobody decide. */
function describe(usage: ReturnType<typeof findAssetUsage>): string[] {
  const scene = useDocumentStore.getState().scene;
  const store = useAssetStore.getState();
  const lines: string[] = [];

  for (const id of usage.entities.slice(0, 12)) {
    lines.push(`Object · ${scene.entities[id]?.name ?? id}`);
  }
  for (const id of usage.materials.slice(0, 6)) {
    lines.push(`Material · ${store.byId(id)?.name ?? id}`);
  }
  for (const id of usage.prefabs.slice(0, 6)) {
    lines.push(`Prefab · ${store.prefabs[id]?.name ?? id}`);
  }
  // Never truncated, because there is only ever one of it — and because it is
  // the use nothing in the viewport points at: an entity that loses a texture
  // looks wrong, a scene that loses its sky looks like a different scene.
  if (usage.environment) lines.push(`Environment · ${scene.name}`);

  const shown =
    Math.min(usage.entities.length, 12) +
    Math.min(usage.materials.length, 6) +
    Math.min(usage.prefabs.length, 6) +
    (usage.environment ? 1 : 0);
  const hidden = totalUses(usage) - shown;
  if (hidden > 0) lines.push(`…and ${hidden} more`);

  return lines;
}

/*
 * The two asset gestures that go through the registry, declared beside the
 * gestures themselves rather than in a file of their own: this module is 219
 * lines and the table is forty, where `sceneFiles.ts` was big enough that its
 * table earned a module.
 *
 * **Neither removes a divergence, and that is worth saying plainly.** The Edit
 * and scene-file families each found callers guarding in their own words and
 * getting it wrong; here the three call sites already went through one function
 * and asked nothing. What the table buys is what T-062 is for — a gesture with
 * an id, a label and a verdict is one a command palette can list (8.4) and a
 * script can name — and the target-carrying context these two need is the same
 * one the remaining families will use.
 *
 * **`revealAsset` brings a panel forward, and that is not milestone 8.5.** That
 * one is about `playCommands` reaching into the dock *as a side effect* of
 * starting the game. Here, putting the Project panel in front **is** the
 * gesture: "show me this asset" with the panel left behind whatever is on top of
 * it has not happened.
 */

/** The asset this context names, or `undefined` if it names none or it is gone. */
function target(assetId: string | undefined) {
  return assetId === undefined ? undefined : useAssetStore.getState().byId(assetId);
}

export const ASSET_COMMANDS = {
  revealAsset: defineCommand({
    label: (ctx) => {
      const asset = target(ctx.assetId);
      return asset ? `Reveal "${asset.name}" in Project` : 'Reveal in Project';
    },
    can: (ctx) => target(ctx.assetId) !== undefined,
    run: (ctx) => {
      if (ctx.assetId !== undefined) revealAsset(ctx.assetId);
    },
  }),

  deleteAsset: defineCommand({
    label: (ctx) => {
      const asset = target(ctx.assetId);
      return asset ? `Delete "${asset.name}"` : 'Delete Asset';
    },
    /**
     * Only that the asset is still there. Being *used* is not a refusal — the
     * gesture says what it would take with it and lets the author decide, which
     * is the whole argument in `deleteAsset` above.
     */
    can: (ctx) => target(ctx.assetId) !== undefined,
    run: async (ctx) => {
      const asset = target(ctx.assetId);
      if (asset) await deleteAsset(asset);
    },
  }),
};
