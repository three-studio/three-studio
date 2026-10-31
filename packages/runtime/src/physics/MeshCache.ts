/**
 * Values computed from a vertex soup, kept by its content.
 *
 * For what is too slow to compute at every Play: a mesh's convex parts take a
 * tenth of a second for a primitive and about one for a detailed model, while
 * the window does not answer. Kept by content rather than by entity, so a
 * second Play, a copy of the entity and every instance of a prefab find what
 * the first computed, and a change of geometry or scale is a new soup.
 *
 * A hit needs the stored arrays to be equal element by element, not only to
 * hash alike: a collision would otherwise hand one mesh another's parts. The
 * last `capacity` soups are kept, the one used longest ago going first.
 */
export class MeshCache<V> {
  /** Oldest first: a hit moves its soup to the end. */
  private readonly soups: Soup<V>[] = [];

  constructor(private readonly capacity = 32) {}

  get(positions: Float32Array, indices: Uint32Array, compute: () => V): V {
    const hash = hashSoup(positions, indices);
    const index = this.soups.findIndex(
      (soup) =>
        soup.hash === hash &&
        sameBits(soup.positions, positions) &&
        sameBits(soup.indices, indices),
    );
    if (index !== -1) {
      const [hit] = this.soups.splice(index, 1);
      if (hit) {
        this.soups.push(hit);
        return hit.value;
      }
    }

    const value = compute();
    this.soups.push({ hash, positions, indices, value });
    if (this.soups.length > this.capacity) this.soups.shift();
    return value;
  }
}

interface Soup<V> {
  hash: number;
  positions: Float32Array;
  indices: Uint32Array;
  value: V;
}

/** FNV-1a over the arrays' bits: a float is hashed as it is stored, `-0` and `NaN` included. */
function hashSoup(positions: Float32Array, indices: Uint32Array): number {
  let hash = 0x811c9dc5;
  for (const words of [bitsOf(positions), indices]) {
    hash = Math.imul(hash ^ words.length, 0x01000193);
    for (const word of words) hash = Math.imul(hash ^ word, 0x01000193);
  }
  return hash >>> 0;
}

function sameBits(a: Float32Array | Uint32Array, b: Float32Array | Uint32Array): boolean {
  if (a.length !== b.length) return false;
  const left = bitsOf(a);
  const right = bitsOf(b);
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
  return true;
}

/** The same memory read as words, so floats compare exactly: `NaN` equals itself, `-0` is not `0`. */
function bitsOf(array: Float32Array | Uint32Array): Uint32Array {
  if (array instanceof Uint32Array) return array;
  return new Uint32Array(array.buffer, array.byteOffset, array.length);
}
