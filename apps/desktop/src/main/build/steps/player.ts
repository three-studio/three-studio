import { readFile } from 'node:fs/promises';
import { BUILD_LAYOUT } from '@three-studio/core';
import { AssetError } from '../../assetFiles';
import { escapeAttribute, insertIntoHead, setTitle } from '../../html';
import type { BuildPlan } from '../buildPlan';
import { walkFiles } from '../walk';

/**
 * The prebuilt player: every file of the template, with the base written into the page.
 *
 * The player arrives as a directory, so the exporter never names its files one
 * by one — they are a walk of the template. A walk is right *here* where it was
 * wrong over the output folder: the template holds the player and nothing else,
 * the output folder holds whatever the author keeps beside the build.
 *
 * The page is planned from the pristine template every time, which is what
 * makes the base removable: re-exporting with the field cleared leaves no tag
 * behind from the last one.
 */
export async function planPlayer(
  plan: BuildPlan,
  template: string,
  page: { base: string; title: string },
): Promise<void> {
  for (const file of await walkFiles(template)) {
    // A `.DS_Store` a Finder window left in the template is not part of the
    // player, and nothing Vite emits starts with a dot.
    if (file.path.split('/').some((segment) => segment.startsWith('.'))) continue;
    if (file.path === BUILD_LAYOUT.page) {
      plan.addBytes(file.path, await pageOf(file.absolute, page), { kind: 'page' });
      continue;
    }
    // Beside the page, its own files — the icon. In `player/`, the engine.
    await plan.addFile(
      file.path,
      file.absolute,
      file.path.startsWith(`${BUILD_LAYOUT.player}/`) ? { kind: 'player' } : { kind: 'page' },
    );
  }
}

/**
 * The page, titled after the game and pointed at the URL the build will be
 * served from.
 *
 * One `<base>` rather than a rewrite of every URL: the page, the player bundle,
 * the JSON documents beside them, every asset and the script bundle are all
 * resolved against the document, so a single tag moves them together and cannot
 * fall out of step with a path added later. It goes first in `<head>`, because
 * it only governs the URLs that come after it.
 */
async function pageOf(file: string, { base, title }: { base: string; title: string }): Promise<string> {
  const html = setTitle(await readFile(file, 'utf8'), title);
  if (html === null) {
    throw new AssetError('The web player page has no <head>, so it cannot be given a title.');
  }
  if (base === '') return html;
  // Escaped though `basePathProblem` already refused the characters that would
  // need it: see `escapeAttribute`.
  const tagged = insertIntoHead(html, `<base href="${escapeAttribute(base)}" />`);
  if (tagged === null) {
    throw new AssetError('The web player page has no <head>, so it cannot be given a base URL.');
  }
  return tagged;
}
