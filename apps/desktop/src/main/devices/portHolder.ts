import { execFile } from 'node:child_process';
import { readlink, realpath } from 'node:fs/promises';
import { posix, win32 } from 'node:path';
import type { PortHolder } from '@three-studio/core';

/*
 * Who holds a port, asked of the system.
 *
 * A crashed process frees its port by itself: the system closes its sockets.
 * What keeps one is a process still alive — frozen, or orphaned, like the
 * Electron that outlives an interrupted `npm run dev` — and the device server
 * can only offer to quit it if it knows which process that is, and whether it
 * is this same program.
 */

/** Long enough for `lsof` on a busy machine; short enough that a start never hangs on it. */
const TIMEOUT = 3000;

/** What the system says about a holder, before it is compared with this program. */
export interface FoundHolder {
  pid: number;
  /** Its executable, or `null` when the system will not say. */
  program: string | null;
}

/** The first process in `lsof -Fp`'s answer — one `p<pid>` line each — that is not this one. */
export function parseLsofPid(output: string, self: number = process.pid): number | null {
  for (const line of output.split('\n')) {
    if (!line.startsWith('p')) continue;
    const pid = Number(line.slice(1));
    if (Number.isInteger(pid) && pid > 0 && pid !== self) return pid;
  }
  return null;
}

/** The PowerShell command's answer, `<pid>\t<path>` per line; the path is empty when Windows will not give it. */
export function parsePowerShellHolder(
  output: string,
  self: number = process.pid,
): FoundHolder | null {
  for (const line of output.split(/\r?\n/)) {
    const [pidText = '', path = ''] = line.split('\t');
    const pid = Number(pidText.trim());
    if (pidText.trim() === '' || !Number.isInteger(pid) || pid <= 0 || pid === self) continue;
    return { pid, program: path.trim() === '' ? null : path.trim() };
  }
  return null;
}

/**
 * Whether two executables are the same file, by path.
 *
 * Without case on macOS and Windows, whose usual file systems ignore it: the
 * same app reached as `/Applications/Three Studio.app` and as
 * `/applications/three studio.app` is one program.
 */
export function isSameProgram(a: string, b: string, platform: NodeJS.Platform): boolean {
  const path = platform === 'win32' ? win32 : posix;
  const left = path.normalize(path.resolve(a));
  const right = path.normalize(path.resolve(b));
  return platform === 'darwin' || platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

/** A command's output, or `null` when it is missing, fails, or takes too long. */
function run(command: string, args: readonly string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: TIMEOUT, windowsHide: true }, (error, stdout) => {
      // `lsof` exits 1 when nothing matches, which is an answer, not a failure.
      resolve(error !== null && stdout === '' ? null : stdout);
    });
  });
}

/**
 * One command rather than `netstat`, whose output is translated: its column
 * names and its states read differently on a French Windows.
 */
function powerShellScript(port: number): string {
  return [
    `$found = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue`,
    'foreach ($c in $found) {',
    '  $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue',
    '  "$($c.OwningProcess)`t$($p.Path)"',
    '}',
  ].join('\n');
}

async function programOf(pid: number, platform: NodeJS.Platform): Promise<string | null> {
  if (platform === 'linux') {
    try {
      return await readlink(`/proc/${pid}/exe`);
    } catch {
      return null;
    }
  }
  // The path it was started from, which is the whole path for an app the
  // system or `npm run dev` started, and a bare name for one started from a
  // shell — which then simply never matches this program.
  const program = (await run('ps', ['-p', String(pid), '-o', 'comm=']))?.trim() ?? '';
  return program === '' ? null : program;
}

/**
 * The process listening on a port, other than this one. `null` when nothing
 * is, or when the system will not say — another user's process, a Linux
 * without `lsof`.
 */
export async function findPortHolder(
  port: number,
  platform: NodeJS.Platform = process.platform,
): Promise<FoundHolder | null> {
  if (platform === 'win32') {
    const output = await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      powerShellScript(port),
    ]);
    return output === null ? null : parsePowerShellHolder(output);
  }
  const output = await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp']);
  const pid = output === null ? null : parseLsofPid(output);
  return pid === null ? null : { pid, program: await programOf(pid, platform) };
}

async function resolved(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

/** The holder of a port, and whether it runs this very executable. */
export async function portHolderOf(port: number): Promise<PortHolder | null> {
  const found = await findPortHolder(port);
  if (found === null) return null;
  const sameApp =
    found.program !== null &&
    isSameProgram(
      await resolved(found.program),
      await resolved(process.execPath),
      process.platform,
    );
  return { ...found, sameApp };
}
