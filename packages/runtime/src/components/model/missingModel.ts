import { BoxGeometry, Mesh, MeshBasicMaterial, type Object3D } from 'three/webgpu';

/*
 * What is drawn where a model used to be.
 *
 * A scene may name an asset that is no longer in the project: deleting one that
 * something uses is allowed — the dialog says how many things will keep the
 * reference — and a scene saved before the delete keeps it as well. That is an
 * ordinary state, and until now it drew nothing at all.
 *
 * Nothing at all is the worst of the options. An entity that draws nothing is
 * indistinguishable from an entity that is not there: it cannot be found in the
 * viewport, cannot be clicked, and the only trace was a stack trace in the
 * console. A box can be seen, and — because it is a `Mesh` and raycasts against
 * its triangles like any other — it can be clicked, selected, and given a new
 * asset. That is the difference between a broken reference and an unfixable one.
 *
 * A unit cube, because the size of what is gone is not knowable: the entity's
 * own scale is applied above this, so a prop that was placed at 3x still reads
 * as a box of roughly the right size.
 */

/**
 * One geometry and one material for every missing model in the project.
 *
 * Shared, and never disposed, so that `ModelSystem.unmount` goes on freeing
 * nothing it did not take — the invariant that keeps it from disposing buffers
 * other clones of a model are still drawing. A hundred broken references cost a
 * hundred `Mesh` objects and one of each of these.
 */
let geometry: BoxGeometry | null = null;
let material: MeshBasicMaterial | null = null;

export function createMissingModel(): Object3D {
  geometry ??= new BoxGeometry(1, 1, 1);
  // Wireframe rather than solid: it has to read as "there is supposed to be
  // something here", not as a box somebody modelled.
  material ??= new MeshBasicMaterial({ color: 0xff5555, wireframe: true });

  const mesh = new Mesh(geometry, material);
  mesh.name = 'Missing model';
  return mesh;
}
