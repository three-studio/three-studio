import { mkdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

/*
 * A device's screenshot, before the Save dialog opens: its size, its name, and
 * the folder the dialog opens in.
 *
 * The bytes came from the network, so they are checked as a PNG by their
 * header alone and never decoded here. A decoder is the part of an image path
 * that untrusted bytes attack, and the main process has nothing to gain from
 * one: the file is written as it came, and Finder and Preview decode it later,
 * as they do any PNG downloaded from anywhere.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Past any canvas a game is drawn into: the canvas is a GPU texture, which
 * WebGPU's default limits keep to 8 192 a side, and WebGL2's rarely pass this.
 */
const SIDE_LIMIT = 16_384;

/**
 * The width and height a PNG's header says, or `null` when the bytes do not
 * start as a PNG does: its signature, then its header chunk — always first,
 * always 13 bytes, named `IHDR` — and a size a canvas could have.
 */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (SIGNATURE.some((byte, index) => bytes[index] !== byte)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13) return null;
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return null;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const fits = (side: number): boolean => side >= 1 && side <= SIDE_LIMIT;
  return fits(width) && fits(height) ? { width, height } : null;
}

/** What one system or another refuses in a file name, and every control character. */
const FORBIDDEN = /[\p{Cc}/\\:*?"<>|]/gu;

/** Long enough for any scene a person names; short enough that the date still shows in Finder. */
const PART_LIMIT = 60;

/*
 * One part of a name, as a file may hold it. The scene's name is the
 * project's and the device's is read from a user agent, so either can hold
 * anything; a name starting with a dot would be a file Finder hides.
 */
function fileNamePart(text: string): string {
  const cleaned = text
    .replace(FORBIDDEN, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+/, '')
    .trim();
  // Cut by code point, so that an emoji in a scene's name is never halved.
  const cut = Array.from(cleaned).slice(0, PART_LIMIT).join('').trim();
  return cut === '' ? 'Untitled' : cut;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * `Level 1 — iPhone · Safari — 2026-10-01 at 14.32.05.png`: the scene, the
 * device, and the local time the person asked, written the way macOS names its
 * own screenshots so that a folder of both sorts by date. The dialog shows it
 * already filled in, and the person may change it.
 */
export function screenshotFileName({
  scene,
  device,
  at,
}: {
  scene: string;
  device: string;
  at: Date;
}): string {
  const date = [at.getFullYear(), at.getMonth() + 1, at.getDate()].map(twoDigits).join('-');
  const time = [at.getHours(), at.getMinutes(), at.getSeconds()].map(twoDigits).join('.');
  return `${fileNamePart(scene)} — ${fileNamePart(device)} — ${date} at ${time}.png`;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The folder a screenshot's Save dialog opens in: the one the project's last
 * screenshot went to, while it is still a folder; otherwise the project's own
 * `Screenshots/`, made now, so the dialog opens inside it — even when the
 * person then cancels. Nothing scans it: a scan reads `assets/` alone.
 */
export async function screenshotFolder(
  remembered: string | undefined,
  projectPath: string,
): Promise<string> {
  if (remembered !== undefined && (await isDirectory(remembered))) return remembered;
  const folder = join(projectPath, 'Screenshots');
  await mkdir(folder, { recursive: true });
  return folder;
}

/**
 * The path a screenshot is written to: the one the dialog gave, ending in
 * `.png`. macOS and Windows add the filter's extension themselves; a Linux
 * dialog may give the name back as typed.
 */
export function withPngExtension(path: string): string {
  return extname(path).toLowerCase() === '.png' ? path : `${path}.png`;
}
