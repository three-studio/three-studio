import { describe, expect, it } from 'vitest';
import { remapFolder } from '../src/state/assetStore';

/*
 * Two things point at a folder while it is being renamed — the Project panel's
 * current folder and the import dialog's destination — and neither is allowed
 * to end up naming something that is no longer there.
 */

describe('remapFolder', () => {
  it('follows the folder itself', () => {
    expect(remapFolder('models', 'models', 'meshes')).toBe('meshes');
  });

  it('follows a descendant', () => {
    expect(remapFolder('models/props/crates', 'models', 'meshes')).toBe('meshes/props/crates');
  });

  it('follows a folder renamed in place', () => {
    expect(remapFolder('models/props', 'models/props', 'models/furniture')).toBe(
      'models/furniture',
    );
  });

  it('leaves an unrelated folder alone', () => {
    expect(remapFolder('textures', 'models', 'meshes')).toBe('textures');
  });

  it('does not match a sibling that merely starts with the same text', () => {
    // The trap a bare `startsWith` falls into: renaming `models` would drag the
    // browser out of `models-old`, which nothing touched.
    expect(remapFolder('models-old', 'models', 'meshes')).toBe('models-old');
    expect(remapFolder('models-old/props', 'models', 'meshes')).toBe('models-old/props');
  });

  it('falls back to the parent when the folder is removed', () => {
    expect(remapFolder('models/props', 'models/props', null)).toBe('models');
    expect(remapFolder('models', 'models', null)).toBe('');
  });

  it('leaves everything alone when the root is named', () => {
    // The root cannot be renamed or removed, and treating `''` as a prefix
    // would rewrite every path in the project.
    expect(remapFolder('models/props', '', 'meshes')).toBe('models/props');
  });
});
