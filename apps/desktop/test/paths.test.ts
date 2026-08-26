import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PathEscapeError, resolveInside } from '../src/main/paths';

const ROOT = resolve('/tmp/studio-project');

/*
 * The renderer is sandboxed, but the paths it hands the main process come out
 * of scene and project files — ordinary documents a user can receive from
 * anyone. Everything below is a path a crafted file could contain.
 */
describe('resolveInside', () => {
  it('accepts paths within the project', () => {
    expect(resolveInside(ROOT, 'scenes/main.scene.json')).toBe(
      join(ROOT, 'scenes/main.scene.json'),
    );
    expect(resolveInside(ROOT, './assets/models/tree.glb')).toBe(
      join(ROOT, 'assets/models/tree.glb'),
    );
    // Traversal that stays inside is still inside.
    expect(resolveInside(ROOT, 'scenes/../assets/a.png')).toBe(join(ROOT, 'assets/a.png'));
  });

  it('rejects traversal out of the project', () => {
    expect(() => resolveInside(ROOT, '../secrets.txt')).toThrow(PathEscapeError);
    expect(() => resolveInside(ROOT, '../../../../etc/passwd')).toThrow(PathEscapeError);
    expect(() => resolveInside(ROOT, 'scenes/../../escaped.json')).toThrow(PathEscapeError);
  });

  it('rejects absolute paths', () => {
    expect(() => resolveInside(ROOT, '/etc/passwd')).toThrow(PathEscapeError);
    expect(() => resolveInside(ROOT, resolve('/tmp/other-project/project.json'))).toThrow(
      PathEscapeError,
    );
  });

  it('rejects the project root itself', () => {
    // Writing "the project" as a file would clobber the directory.
    expect(() => resolveInside(ROOT, '')).toThrow(PathEscapeError);
    expect(() => resolveInside(ROOT, '.')).toThrow(PathEscapeError);
  });

  it('rejects a sibling directory with a shared prefix', () => {
    // `/tmp/studio-project-evil` starts with the root string but is not inside it.
    expect(() => resolveInside(ROOT, '../studio-project-evil/x.json')).toThrow(PathEscapeError);
  });
});
