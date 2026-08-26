import type { Transform } from '@three-studio/core';
import { Bone, SkinnedMesh, type Mesh, type Object3D } from 'three/webgpu';

/*
 * Reading the shape of a loaded model, and finding one node of it again.
 *
 * The half of `unpackModel` that needs three.js, kept apart from the half that
 * does not: `packages/core` cannot import three, and the entity-building that
 * turns this description into a sub-tree is where the interesting decisions are.
 * So the walk lives here and hands back **plain data** — no `Object3D` escapes —
 * and `scene/modelUnpack.ts` builds the entities from that, in a test that needs
 * no renderer.
 */

/**
 * How a node is named in a stored `ModelComponent.nodePath`.
 *
 * Child indices, dot-separated, and **the root is `'0'`** rather than the empty
 * string: `''` already means "the whole file" on the component, and a file whose
 * loaded root happens to draw would otherwise have no way to say "just that".
 *
 * Indices rather than names because a name is unique in neither glTF nor FBX —
 * an export with four meshes called `Cube` is the common case, not the odd one —
 * and `Object3D.clone(true)` preserves child order, so an index survives every
 * copy the cache hands out.
 */
const ROOT_PATH = '0';

/** One node of a loaded model, as `unpackModel` needs to see it. */
export interface ModelNodeDesc {
  /** `'0'` for the root, `'0.2.1'` for its third child's second. */
  path: string;
  /** The path of the node above; `null` on the root alone. */
  parentPath: string | null;
  /** The file's own name for it, which is often `''`. */
  name: string;
  /** Local, as stored on the node — the entity that replaces it carries it. */
  transform: Transform;
  /**
   * Whether the node itself draws.
   *
   * Itself, not its subtree: a node that draws *and* has children becomes an
   * entity that draws and has child entities, and each of those draws its own
   * node. `ModelCache.loadNode` clones without descendants for exactly this
   * reason — cloning the subtree would draw every child twice.
   */
  draws: boolean;
}

/** What one model file turned out to be. */
export interface ModelShape {
  nodes: readonly ModelNodeDesc[];
  /**
   * Whether anything in it is skinned.
   *
   * A `SkinnedMesh` reads its pose from a `Skeleton` of `Bone`s that are
   * elsewhere in the same tree, and the binding is by object reference. Splitting
   * the tree into entities hands each node to a separate container and leaves the
   * skin pointing at bones that are no longer above it — the model does not fail,
   * it collapses into a heap at the origin. `unpackModel` refuses instead.
   */
  skinned: boolean;
}

/** Reads the local transform three keeps on a node. */
function transformOf(node: Object3D): Transform {
  return {
    position: [node.position.x, node.position.y, node.position.z],
    rotation: [node.rotation.x, node.rotation.y, node.rotation.z],
    scale: [node.scale.x, node.scale.y, node.scale.z],
  };
}

/** True for a node that has geometry of its own to draw. */
function draws(node: Object3D): boolean {
  return (node as Partial<Mesh>).geometry !== undefined;
}

/**
 * Every node of a loaded model, parents before children.
 *
 * Depth-first and in child order, which is what lets the caller build entities
 * in one pass: a node's parent is always already there.
 */
export function describeNodes(root: Object3D): ModelShape {
  const nodes: ModelNodeDesc[] = [];
  let skinned = false;

  const visit = (node: Object3D, path: string, parentPath: string | null): void => {
    if (node instanceof SkinnedMesh || node instanceof Bone) skinned = true;
    nodes.push({
      path,
      parentPath,
      name: node.name,
      transform: transformOf(node),
      draws: draws(node),
    });
    node.children.forEach((child, index) => {
      visit(child, `${path}.${index}`, path);
    });
  };

  visit(root, ROOT_PATH, null);
  return { nodes, skinned };
}

/**
 * The node a stored path names, or the one that has moved under it.
 *
 * The path is relative to the tree **as the import settings dress it**, and
 * those settings can be changed after a scene was written — turning glTF lights
 * back on inserts nodes and slides every index after them. The name is the belt
 * to that brace: it is not unique, so it cannot be the primary key, but the
 * first node carrying it is a far better answer than nothing.
 *
 * @returns `null` when neither the path nor the name finds anything, which the
 *   caller reports rather than drawing something else.
 */
export function resolveNode(root: Object3D, path: string, name = ''): Object3D | null {
  const parts = path.split('.');
  if (parts[0] === ROOT_PATH) {
    let node: Object3D | undefined = root;
    for (const part of parts.slice(1)) {
      node = node?.children[Number(part)];
    }
    // The name is checked, not trusted: an index that still resolves but now
    // lands on a different node is the failure this is here to catch.
    if (node && (name === '' || node.name === name)) return node;
  }

  if (name === '') return null;
  return root.getObjectByName(name) ?? null;
}
