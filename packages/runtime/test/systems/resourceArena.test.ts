import { BoxGeometry, MeshStandardNodeMaterial, Texture } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { ResourceArena, SharedMaterial } from '../../src/systems/ResourceArena';

/*
 * The pool, the queue, and the one rule that ties them: **nothing is freed
 * inside a sync**.
 *
 * Two of the twelve bugs were here and neither was a wrong line. B6 was a
 * cadence — the queue was drained by whatever ran next rather than by the frame
 * — and B5 was ownership, a `replace` freeing the value another holder had just
 * adopted. Both are properties of this class, and until phase 11 it was not one.
 */

const material = () => new SharedMaterial({ material: new MeshStandardNodeMaterial(), textures: [] });

describe('counting references', () => {
  it('hands back the same value and frees it only when the last holder lets go', () => {
    const arena = new ResourceArena();
    const first = arena.geometry('box', () => new BoxGeometry());
    const second = arena.geometry('box', () => new BoxGeometry());

    // A thousand instances of one prefab are one set of buffers. That is the
    // whole reason prefabs are held by reference.
    expect(second).toBe(first);
    expect(arena.sizes.geometries).toBe(1);

    arena.releaseGeometry('box');
    expect(arena.sizes.geometries).toBe(1);
    arena.releaseGeometry('box');
    expect(arena.sizes.geometries).toBe(0);
  });

  it('builds again after the pool has let go', () => {
    const arena = new ResourceArena();
    arena.geometry('box', () => new BoxGeometry());
    arena.releaseGeometry('box');

    const rebuilt = arena.geometry('box', () => new BoxGeometry());
    expect(rebuilt).toBeInstanceOf(BoxGeometry);
    expect(arena.sizes.geometries).toBe(1);
  });
});

describe('when things are actually freed', () => {
  it('defers to the frame rather than to the release', () => {
    const arena = new ResourceArena();
    let disposed = 0;
    const geometry = new BoxGeometry();
    geometry.dispose = () => {
      disposed += 1;
    };

    arena.geometry('box', () => geometry);
    arena.releaseGeometry('box');

    // B6. `WebGPURenderer.render` returns a promise the loops do not await, so
    // a buffer freed here is handed to a pass still being encoded — a crash,
    // not a dropped frame. Two syncs can also land in one microtask, which is
    // what made "a frame old now" false.
    expect(disposed).toBe(0);

    arena.flush();
    expect(disposed).toBe(1);
  });

  it('frees a retired object once and only once', () => {
    const arena = new ResourceArena();
    let disposed = 0;
    arena.retire({ dispose: () => void (disposed += 1) });

    arena.flush();
    arena.flush();
    expect(disposed).toBe(1);
  });
});

describe('replacing what a key holds', () => {
  it('retires the old value instead of disposing it under its holders', () => {
    const arena = new ResourceArena();
    const first = material();
    let disposed = 0;
    first.dispose = () => void (disposed += 1);

    arena.material('mat-1', () => first);
    arena.replaceMaterial('mat-1', material());

    // B5's shape: the replaced material is still what some mesh is drawing with
    // this frame. Freeing it here is what handed a destroyed pipeline to a pass
    // in flight; the queue is what makes the swap safe.
    expect(disposed).toBe(0);
    arena.flush();
    expect(disposed).toBe(1);
  });

  it('leaves the reference count alone, so the swap is not a release', () => {
    const arena = new ResourceArena();
    arena.material('mat-1', material);
    arena.material('mat-1', material);

    arena.replaceMaterial('mat-1', material());

    // Two meshes still name the asset. A `replace` that also decremented would
    // free the new value the moment one of them let go.
    arena.releaseMaterial('mat-1');
    expect(arena.sizes.materials).toBe(1);
    arena.releaseMaterial('mat-1');
    expect(arena.sizes.materials).toBe(0);
  });

  it('does nothing for a key nothing holds', () => {
    const arena = new ResourceArena();
    expect(() => arena.replaceMaterial('never-acquired', material())).not.toThrow();
    expect(arena.sizes.materials).toBe(0);
  });
});

describe('shutting down', () => {
  it('frees the pools and the queue together', () => {
    const arena = new ResourceArena();
    let disposed = 0;
    const texture = new Texture();
    texture.dispose = () => void (disposed += 1);

    arena.material('mat-1', () => new SharedMaterial({ material: new MeshStandardNodeMaterial(), textures: [texture] }));
    arena.retire({ dispose: () => void (disposed += 1) });

    arena.disposeAll();

    // Nothing is rendering any more, so there is nothing left to wait for —
    // which is why this is the one place that frees without a frame.
    expect(disposed).toBe(2);
    expect(arena.sizes).toEqual({ geometries: 0, materials: 0 });
  });
});
