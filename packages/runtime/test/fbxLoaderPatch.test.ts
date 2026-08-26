import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

/**
 * three's `FBXLoader` reads `LayerElementNormal[0].Normals` without checking it
 * is there, while guarding `Colors` and `UV` in the very same function. An FBX
 * that declares a normal layer and leaves it empty — which is what an Unreal
 * `UCX_` collision hull is, and they travel inside the same file as the mesh
 * they hull — therefore throws `Cannot read properties of undefined (reading
 * 'a')`. The throw loses the whole file rather than the one empty layer: the
 * model next to it never arrives either, and all the editor can say is that
 * the asset failed to load.
 *
 * Still unfixed on three's `dev` branch at 0.185.1, so
 * `patches/three+0.185.1.patch` adds the guard.
 *
 * Asserted against the installed source rather than by loading a fixture,
 * because the parser is not what breaks — the patch silently not being applied
 * is. An install without the `postinstall`, or a version bump that moves the
 * line, puts the crash back with nothing to show for it.
 */
describe('the FBXLoader patch', () => {
  it('guards the normal layer the way three already guards colours and UVs', () => {
    const require = createRequire(import.meta.url);
    const source = readFileSync(require.resolve('three/addons/loaders/FBXLoader.js'), 'utf8');

    expect(source).toContain('geoNode.LayerElementNormal[ 0 ].Normals');
  });
});
