import { rename, rm, writeFile } from 'node:fs/promises';
import { createId } from '@three-studio/core';

/**
 * Writes a file whole, or not at all.
 *
 * The bytes go to a temporary file beside the target and are renamed onto it,
 * which is atomic: a reader gets the old content or the new, never a truncated
 * file. `writeFile` alone does not give that, and the gap is reachable — a scan
 * writes sidecars as well as reading them, and more than one can be in flight;
 * `exportBuild` ran three at once until it was made to read the tree once, and
 * the handlers behind the material and prefab libraries still scan on their own.
 *
 * The failure that motivated it was not a crash. A half-written sidecar fails
 * to parse, `readAssetMeta` answers `null`, and the asset is adopted **with a
 * fresh id** — so a scene that referenced it now references nothing, and an
 * export ships a level with a texture missing. It first showed up as a test
 * that passed four runs out of six.
 *
 * **The temporary name carries an id.** That used to be true of the sidecars
 * alone, and it is the rule rather than the special case: two writers racing on
 * one file would otherwise overwrite each other's half-written copy, and
 * nothing anywhere needed the name to be predictable. What it costs is that a
 * process killed mid-write leaves an orphan rather than one the next write
 * would have replaced — inert, since no scan and no scene discovery claims a
 * `.tmp`.
 *
 * **One answer to failure**, where there were five: the temporary file goes and
 * the error is the caller's. The two callers with a reason to swallow it — a
 * layout that cannot be saved, a cache that cannot be written — say so at their
 * own call site, next to the reason.
 */
export async function atomicWrite(target: string, contents: string): Promise<void> {
  const staging = `${target}.${createId()}.tmp`;
  try {
    await writeFile(staging, contents, 'utf8');
    await rename(staging, target);
  } catch (cause) {
    // The original failure is what the caller needs to hear about, so a
    // clean-up that fails too is not allowed to replace it.
    await rm(staging, { force: true }).catch(() => undefined);
    throw cause;
  }
}
