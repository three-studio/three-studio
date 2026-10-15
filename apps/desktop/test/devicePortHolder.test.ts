import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findPortHolder,
  isSameProgram,
  parseLsofPid,
  parsePowerShellHolder,
} from '../src/main/devices/portHolder';

/*
 * Who holds a port: what the system answers, read apart from asking it, then
 * asked for real about a child process that holds one.
 */

const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
});

describe('what lsof answers', () => {
  it('names the first process that is not this one', () => {
    expect(parseLsofPid('p4242\nf12\n', 1)).toBe(4242);
    expect(parseLsofPid(`p${process.pid}\nf12\np4243\nf13\n`)).toBe(4243);
  });

  it('names nothing when only this process holds it, or when it says nothing', () => {
    expect(parseLsofPid(`p${process.pid}\nf12\n`)).toBeNull();
    expect(parseLsofPid('')).toBeNull();
    expect(parseLsofPid('lsof: WARNING: something\n')).toBeNull();
  });
});

describe('what PowerShell answers', () => {
  it('reads a process id and its path', () => {
    expect(parsePowerShellHolder('4242\tC:\\Program Files\\Three Studio\\Three Studio.exe\r\n', 1)).toEqual({
      pid: 4242,
      program: 'C:\\Program Files\\Three Studio\\Three Studio.exe',
    });
  });

  it('keeps the id when Windows will not give the path', () => {
    expect(parsePowerShellHolder('4242\t\r\n', 1)).toEqual({ pid: 4242, program: null });
  });

  it('reads nothing out of garbage', () => {
    expect(parsePowerShellHolder('Get-NetTCPConnection : not found', 1)).toBeNull();
    expect(parsePowerShellHolder('', 1)).toBeNull();
    expect(parsePowerShellHolder(`${process.pid}\tC:\\self.exe`)).toBeNull();
  });
});

describe('the same program', () => {
  it('ignores case where the file system does', () => {
    expect(
      isSameProgram('/Applications/Three Studio.app/x', '/applications/three studio.app/x', 'darwin'),
    ).toBe(true);
    expect(isSameProgram('C:\\Apps\\Studio.exe', 'c:\\apps\\studio.EXE', 'win32')).toBe(true);
    expect(isSameProgram('/opt/studio/Studio', '/opt/studio/studio', 'linux')).toBe(false);
  });

  it('compares paths, not names', () => {
    expect(isSameProgram('/a/node', '/b/node', 'darwin')).toBe(false);
    expect(isSameProgram('/a/./node', '/a/node', 'linux')).toBe(true);
  });
});

const hasLsof =
  process.platform !== 'win32' && spawnSync('lsof', ['-v'], { stdio: 'ignore' }).error === undefined;

describe.skipIf(!hasLsof)('a real holder', () => {
  it('is a child node listening on loopback: its id and its program', async () => {
    const child = spawn(process.execPath, [
      '-e',
      "const s = require('net').createServer().listen(0, '127.0.0.1', () => process.stdout.write(String(s.address().port)))",
    ]);
    children.push(child);
    const port = await new Promise<number>((resolve) => {
      child.stdout!.once('data', (data: Buffer) => resolve(Number(data.toString())));
    });

    const holder = await findPortHolder(port);

    expect(holder?.pid).toBe(child.pid);
    expect(await realpath(holder!.program!)).toBe(await realpath(process.execPath));
  });
});
