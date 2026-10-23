import { describe, expect, it } from 'vitest';
import { BuildPathError, foldKey, toBuildPath } from '../src/main/build/buildPath';

/*
 * Almost no name in a build is the exporter's: assets are named by the
 * project, scenes by the id in their own file, side files by the model that
 * names them. This is the one gate they all pass.
 */
describe('what a build can hold', () => {
  it('takes the names a project is made of', () => {
    for (const path of [
      'index.html',
      'assets/textures/brick wall #2.a1b2c3d4.png',
      'assets/models/Tri/maps/albedo.png',
      'scenes/g3hts8fKiM1V.json',
      'assets/leaf..final.png',
      '.nojekyll',
    ]) {
      expect(toBuildPath(path)).toBe(path);
    }
  });

  it('refuses whatever would leave the folder, or mean something else on another system', () => {
    for (const path of [
      '',
      '/etc/passwd',
      '../escaped.json',
      'scenes/../../escaped.json',
      'assets/./brick.png',
      'assets//brick.png',
      'assets\\brick.png',
      'assets/brick\u0000.png',
      'assets/con.png',
      'assets/LPT1',
      'assets/name.',
      'assets/name ',
    ]) {
      expect(() => toBuildPath(path), path).toThrow(BuildPathError);
    }
  });

  it('composes a decomposed name, as git commits it and a host compares it', () => {
    const decomposed = 'assets/café.png';
    expect(toBuildPath(decomposed)).toBe('assets/café.png');
  });

  it('folds the names a case-blind volume stores as one file', () => {
    expect(foldKey(toBuildPath('assets/Brick.png'))).toBe(foldKey(toBuildPath('assets/brick.PNG')));
    expect(foldKey(toBuildPath('assets/brick.png'))).not.toBe(foldKey(toBuildPath('assets/bricks.png')));
  });
});
