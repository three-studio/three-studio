import type { BufferGeometry, Material, Texture } from 'three/webgpu';

/** Anything the runtime owns on the GPU and must release when it lets go. */
export interface Disposable {
  dispose(): void;
}

/**
 * Resources held by several meshes at once, freed when the last one lets go.
 *
 * A thousand instances of one prefab used to mean a thousand copies of the same
 * box — the reference model was chosen precisely so they would not be, and
 * without this the saving stopped at the document. Reference counted rather than
 * cached-and-never-freed: a geometry is only cheap while something needs it.
 */
class SharedPool<T extends Disposable> {
  private readonly entries = new Map<string, { value: T; refs: number }>();

  /**
   * @param free How to let go of a value. The arena hands in its retire queue
   *   rather than letting the pool call `dispose` itself: freeing a buffer the
   *   frame in flight is still reading is a crash, not a dropped frame.
   */
  constructor(private readonly free: (value: T) => void) {}

  acquire(key: string, make: () => T): T {
    const existing = this.entries.get(key);
    if (existing) {
      existing.refs += 1;
      return existing.value;
    }
    const value = make();
    this.entries.set(key, { value, refs: 1 });
    return value;
  }

  /** Swaps what a key holds, for a shared material edited in place. */
  replace(key: string, value: T): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.free(entry.value);
    entry.value = value;
  }

  peek(key: string): T | undefined {
    return this.entries.get(key)?.value;
  }

  release(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.refs -= 1;
    if (entry.refs > 0) return;
    this.free(entry.value);
    this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }

  disposeAll(): void {
    for (const entry of this.entries.values()) this.free(entry.value);
    this.entries.clear();
  }
}

/** A material asset and the textures only it uses, freed together. */
export class SharedMaterial implements Disposable {
  readonly material: Material;
  readonly textures: Texture[];

  constructor(built: { material: Material; textures: Texture[] }) {
    this.material = built.material;
    this.textures = built.textures;
  }

  dispose(): void {
    this.material.dispose();
    for (const texture of this.textures) texture.dispose();
  }
}

/**
 * Where GPU resources are pooled, and when they are actually freed.
 *
 * One owner and one policy, which is what this used to lack: the pools were
 * fields of `SceneBinder` and the release queue was three methods further down,
 * so "who frees this, and when" had to be reassembled from four places every
 * time it mattered — and it mattered for two of the twelve bugs.
 *
 * **The queue is paced on the frame, never on the sync.** That is B6, and the
 * comment it replaced claimed the queue was "a frame old now" — true only if
 * syncs come one per frame, which two paths break in opposite directions.
 * `assetStore.refresh()` fires `onMaterialsChanged` then `onPrefabsChanged` back
 * to back and each syncs, so one sync retired and the next freed **in the same
 * microtask with no render between them** — the crash this queue exists to
 * prevent. And a sync that finds nothing dirty returns early, so anything
 * retired just before pressing Play stayed resident for the whole session.
 */
export class ResourceArena {
  private readonly geometries = new SharedPool<BufferGeometry>((value) => this.retire(value));
  private readonly materials = new SharedPool<SharedMaterial>((value) => this.retire(value));
  /** GPU objects waiting for the frame that may still be holding them. */
  private readonly retired: Disposable[] = [];

  geometry(key: string, make: () => BufferGeometry): BufferGeometry {
    return this.geometries.acquire(key, make);
  }

  releaseGeometry(key: string): void {
    this.geometries.release(key);
  }

  material(key: string, make: () => SharedMaterial): SharedMaterial {
    return this.materials.acquire(key, make);
  }

  /** What the pool holds without taking a reference. */
  peekMaterial(key: string): SharedMaterial | undefined {
    return this.materials.peek(key);
  }

  /**
   * Swaps the material an asset id resolves to.
   *
   * Called from exactly one place — the pass that reconciles the material
   * library — and that is the whole of B5. Each mesh used to decide this for
   * itself against its own stale `previous`: for N meshes on one asset, N of
   * them took the "the definition changed" branch, and each `replace` frees
   * whatever the key currently holds. Mesh 1 built M2 and retired M1, mesh 2
   * built M3 and retired **M2** — the material mesh 1 had just adopted.
   */
  replaceMaterial(key: string, value: SharedMaterial): void {
    this.materials.replace(key, value);
  }

  releaseMaterial(key: string): void {
    this.materials.release(key);
  }

  /**
   * Hands a resource over to be freed after the next rendered frame.
   *
   * Never `dispose()` directly from a sync: the frame being encoded may still
   * hold the buffer, and freeing it there is what surfaced as
   * `setIndexBuffer: parameter 1 is not of type GPUBuffer`.
   */
  retire(disposable: Disposable): void {
    this.retired.push(disposable);
  }

  /** Frees what the previous frame let go of. Called once per rendered frame. */
  flush(): void {
    for (const resource of this.retired) resource.dispose();
    this.retired.length = 0;
  }

  /** Distinct pooled resources, for tests and for the stats overlay. */
  get sizes(): { geometries: number; materials: number } {
    return { geometries: this.geometries.size, materials: this.materials.size };
  }

  /**
   * Frees everything, pools and queue alike.
   *
   * Last in `dispose()`, because everything above it retires rather than frees.
   * Nothing is rendering any more, so there is nothing left to wait for.
   */
  disposeAll(): void {
    this.geometries.disposeAll();
    this.materials.disposeAll();
    this.flush();
  }
}
