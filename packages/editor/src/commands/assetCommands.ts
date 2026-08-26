import { findAssetUsage, isUsed, totalUses, type AssetEntry } from '@three-studio/core';
import { askForText, askToConfirm } from '../state/dialogStore';
import { useAssetStore } from '../state/assetStore';
import { useDocumentStore } from '../state/documentStore';
import { notify } from '../state/toastStore';

/**
 * Deletes an asset, after saying what it would take with it.
 *
 * The file leaves the project and no amount of Cmd+Z brings it back, so this is
 * the one operation that has to ask. Unity refuses outright when something
 * references an asset; asking instead is the middle ground — sometimes deleting
 * a used asset is exactly the intent, and an editor that only says no makes you
 * go around it in Finder.
 */
export async function deleteAsset(asset: AssetEntry): Promise<void> {
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
        : /[/\\:*?"<>|]/.test(value)
          ? 'A folder name cannot contain / \\ : * ? " < > |'
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
        : /[/\\:*?"<>|]/.test(value)
          ? 'A folder name cannot contain / \\ : * ? " < > |'
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
