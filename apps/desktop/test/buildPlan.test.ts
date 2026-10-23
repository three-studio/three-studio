import { describe, expect, it } from 'vitest';
import { BuildCollisionError, BuildPlan } from '../src/main/build/buildPlan';

/*
 * Every step adds to one plan, and the plan is where two of them meet. Before
 * it, a companion and an asset that wanted the same path simply overwrote each
 * other on the disk, and a volume that ignores case made two names one file.
 */
const roots = new Set(['index.html', 'assets', 'scenes', 'build.json']);
const asset = (assetId: string) => ({ kind: 'asset', assetId, assetKind: 'texture' }) as const;

describe('a build plan', () => {
  it('lists every file once, in the same order on every machine', () => {
    const plan = new BuildPlan(roots);
    plan.addBytes('scenes/b.json', '{}', { kind: 'scene', sceneId: 'b' });
    plan.addBytes('index.html', '<!doctype html>', { kind: 'page' });
    plan.addBytes('assets/a.png', 'a', asset('tex-a'));

    expect(plan.files().map((file) => file.path)).toEqual([
      'assets/a.png',
      'index.html',
      'scenes/b.json',
    ]);
    const [first] = plan.files();
    expect(first!.bytes).toBe(1);
    expect(first!.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('takes the same file twice, as two models in one folder name one buffer', () => {
    const plan = new BuildPlan(roots);
    plan.addBytes('assets/Tri.bin', 'buffer', asset('model-a'));
    plan.addBytes('assets/Tri.bin', 'buffer', asset('model-b'));
    expect(plan.files()).toHaveLength(1);
  });

  it('refuses two files at one path, and names both', () => {
    const plan = new BuildPlan(roots);
    plan.addBytes('assets/a.png', 'one', asset('tex-one'));
    expect(() => plan.addBytes('assets/a.png', 'two', asset('tex-two'))).toThrow(
      /asset tex-one and asset tex-two both need assets\/a\.png/,
    );
  });

  it('refuses two names a case-blind volume would store as one file', () => {
    const plan = new BuildPlan(roots);
    plan.addBytes('assets/Brick.png', 'one', asset('tex-upper'));
    expect(() => plan.addBytes('assets/brick.png', 'one', asset('tex-lower'))).toThrow(
      BuildCollisionError,
    );
  });

  it('refuses a file where another needs a folder, either way round', () => {
    const plan = new BuildPlan(roots);
    plan.addBytes('assets/tree', 'a file', asset('tex-tree'));
    expect(() => plan.addBytes('assets/tree/bark.png', 'b', asset('tex-bark'))).toThrow(
      /which is a file/,
    );

    const other = new BuildPlan(roots);
    other.addBytes('assets/tree/bark.png', 'b', asset('tex-bark'));
    expect(() => other.addBytes('assets/tree', 'a file', asset('tex-tree'))).toThrow(
      /which is a folder/,
    );
  });

  it('refuses a file outside the names the export owns', () => {
    // A step planning there has a bug, and the author's files are out there.
    const plan = new BuildPlan(roots);
    expect(() => plan.addBytes('README.md', '# Mine', { kind: 'page' })).toThrow(/outside the names/);
  });

  it('keeps nothing of a file it refused', () => {
    const plan = new BuildPlan(roots);
    plan.addBytes('assets/tree', 'a file', asset('tex-tree'));
    expect(() => plan.addBytes('assets/tree/bark.png', 'b', asset('tex-bark'))).toThrow();
    // The refused file's folders were not recorded, so this is no conflict.
    expect(plan.files().map((file) => file.path)).toEqual(['assets/tree']);
  });
});
