import { BatchedMesh, Mesh, type Object3D } from 'three/webgpu';
import type { Reconciler } from './Reconciler';
import { resolveEntityId } from './systems/identity';
import type { MeshHandle } from './systems/MeshSystem';
import type { ResourceArena } from './systems/ResourceArena';

/**
 * Fewer than this and the bookkeeping costs more than the draw calls it saves.
 * A batch of one is strictly worse than the mesh it replaces.
 *
 * A threshold for *creating* a batch, and only that. A group that falls under it
 * later keeps the object it has: destroying it means re-uploading the geometry
 * and re-registering every instance, and the next edit that brings the member
 * back would pay the same again. Hiding one of four cubes used to do exactly
 * that, twice.
 */
const MIN_BATCH_SIZE = 4;

/**
 * Spare instance slots to open a batch with, so the next object placed in a
 * field of three thousand does not rebuild all three thousand.
 *
 * `maxInstanceCount` is fixed at construction — it sizes the matrix texture and
 * the multi-draw arrays — so growth has to be paid for up front or not at all.
 * A quarter over, plus a floor for small groups: 64 bytes of matrix texture per
 * spare slot, against a full geometry upload per placement.
 */
const headroomFor = (members: number): number => Math.ceil(members * 1.25) + 8;

/**
 * The layer everything in this project lives on — three's default, and the only
 * one `Raycaster` is ever pointed at. Nothing else in the repo touches layers,
 * so a member can be taken out of it and put back without asking anyone.
 */
const RAYCAST_LAYER = 0;

interface BatchGroup {
  mesh: BatchedMesh;
  /** What every instance draws; kept so a new member can be added in place. */
  geometryId: number;
  /** The hidden meshes whose world matrices feed it, and the slot each holds. */
  members: { mesh: Mesh; slot: number }[];
  /** The same, keyed for the one lookup that has to be fast: a click. */
  bySlot: Map<number, Mesh>;
}

/**
 * Whether the author wants this mesh drawn — which is a different question from
 * whether its own `visible` flag is set.
 *
 * The mesh's own flag is ours: joining a batch hides it, because the batch
 * draws it instead. Asking about it here is a loop — the batch hides its
 * members, the next sync sees them hidden and drops the group, disposing the
 * batch, which unhides them, and the sync after that builds it again. That ran
 * twice a frame while a slider was dragged, and freeing GPU buffers under a
 * frame still being encoded is what surfaced as `setIndexBuffer: parameter 1 is
 * not of type GPUBuffer`.
 *
 * The entity's own visibility lives on the container above it, so the walk
 * starts there. Three does not inherit `visible` into `matrixWorld`, so a mesh
 * under a hidden parent still reports one — the question has to be asked all
 * the way up rather than one level.
 */
export function isVisibleInHierarchy(mesh: Object3D): boolean {
  let current: Object3D | null = mesh.parent;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

/**
 * Draws meshes that share a geometry and a material in one call.
 *
 * On in play mode and on in the editor since `bee3e28`: a click on a batch
 * resolves through `resolveBatchHit` to the instance it landed on, and the
 * outline and the gizmo were never affected — both work off the entity's
 * container, which a batched mesh still hangs from.
 *
 * Measured at 2000–3000 instances: a frame goes from 11.5ms to 8.4ms in play,
 * and from 8.9ms to 8.4ms in the viewport. The saving is CPU-side per-object
 * work, not fewer submissions — three's WebGPU backend still reports one draw
 * call per instance, so the usual "N calls become one" does not hold here yet.
 *
 * A class rather than a set of methods on the binder because it owns
 * `BatchedMesh` objects with a lifetime, which is this repo's one rule for the
 * question. It reads every mesh in the scene at once, which is why it could not
 * become a per-component system.
 */
export class MeshBatcher {
  constructor(
    private readonly root: Object3D,
    private readonly reconciler: Reconciler,
    private readonly arena: ResourceArena,
    /**
     * Entities whose light casts a shadow. Empty means per-instance culling is
     * safe; see `createBatch`.
     */
    private readonly shadowCasters: ReadonlySet<string>,
  ) {}

  /** Off by default; the editor and the engine both turn it on. */
  enabled = false;
  private readonly batches = new Map<string, BatchGroup>();
  /**
   * Where each batched mesh sits, so a moved entity can have its matrix written
   * without walking every batch.
   *
   * Keyed by `Object3D` rather than by `Mesh` so the subtree walk in
   * `updateBatches` can ask about anything it finds without casting.
   */
  private readonly slotOf = new Map<Object3D, { group: BatchGroup; slot: number }>();
  /**
   * True when a batch's *membership* may have changed — a component rebuilt, a
   * binding removed, a visibility flipped.
   *
   * A `setTransform` changes none of those: immer keeps the identity of the
   * component array it did not touch, so nothing is rebuilt and the groups are
   * exactly what they were. Regrouping anyway walked all 2000 bindings and all
   * their mesh builds, once per frame of a drag, to arrive at the same answer.
   */
  private dirty = true;
  /**
   * Slots a regroup just handed out, which hold an identity matrix until the
   * sync writes the real one.
   *
   * A list rather than a "something changed" flag, because the flag meant a
   * full pass: placing one crate in a field of three thousand wrote three
   * thousand matrices and re-uploaded a 246KB matrix texture for the one slot
   * that needed it. That is the cost `3edc80c` removed, coming back through
   * another door.
   *
   * A regroup that only *removed* members adds nothing here: `deleteInstance`
   * frees an id without moving any other, so every surviving slot still holds
   * the matrix it held.
   */
  private readonly pending: { group: BatchGroup; slot: number }[] = [];

  /** Says that what a group could hold may have changed. */
  invalidate(): void {
    this.dirty = true;
  }

  /**
   * One sync's worth of batching: regroup what changed, then write matrices.
   *
   * @param full Whether the sync that called this re-read the whole scene.
   * @param ids What that sync was told was dirty.
   */
  sync(full: boolean, ids: ReadonlySet<string>): void {
    if (!this.enabled) {
      this.clear();
      return;
    }

    this.rebuildBatches();
    // Outside the regroup: adding or editing a shadow-casting light changes
    // this answer without changing any group's membership.
    const cull = this.shadowCasters.size === 0;
    for (const group of this.batches.values()) {
      if (group.mesh.perObjectFrustumCulled === cull) continue;
      group.mesh.perObjectFrustumCulled = cull;
      // Giving culling up is not enough to get the culled instances back: with
      // sorting off too, `onBeforeRender` skips its work entirely, and changing
      // the flag is not a change it watches for. Whatever the last culled pass
      // decided would stand — the instances off screen at that moment never
      // coming back.
      if (!cull) this.refreshDrawList(group);
    }

    // The slots the regroup just handed out, then the matrices of whatever
    // moved. Separately, because they answer different questions: one is "this
    // instance has never had a matrix", the other is "this object moved".
    this.writeNewSlots();
    this.updateBatches(full ? undefined : ids);
  }

  /** Fills in the slots a regroup created, and nothing else. */
  private writeNewSlots(): void {
    if (this.pending.length === 0) return;
    this.root.updateMatrixWorld(true);

    for (const { group, slot } of this.pending) {
      const mesh = group.bySlot.get(slot);
      // Gone again already: a slot handed out by one regroup can be freed by
      // the next before either is drawn.
      if (mesh) group.mesh.setMatrixAt(slot, mesh.matrixWorld);
    }
    this.pending.length = 0;
  }

  /**
   * Regroups only what changed.
   *
   * Called on every sync, so it is called on every keystroke. Building a
   * `BatchedMesh` uploads a geometry and registers every instance, and doing
   * that for three thousand objects because one of them was renamed would cost
   * far more than the batch ever saves. A group that can absorb its difference
   * keeps the object it already has.
   */
  private rebuildBatches(): void {
    if (!this.dirty) return;
    this.dirty = false;

    const groups = new Map<string, MeshHandle[]>();
    for (const handle of this.reconciler.meshHandles()) {
      // Anything hidden is left out rather than given a zero matrix: three's
      // per-instance visibility would need its own bookkeeping, and a batch
      // is regrouped whenever the document changes anyway.
      if (!isVisibleInHierarchy(handle.mesh)) continue;

      const members = groups.get(handle.batchKey);
      if (members) members.push(handle);
      else groups.set(handle.batchKey, [handle]);
    }

    for (const [key, group] of [...this.batches]) {
      const members = groups.get(key);
      if (members && this.refit(group, members)) continue;
      this.disposeBatch(key);
    }

    for (const [key, members] of groups) {
      if (this.batches.has(key)) continue;
      // Below the threshold the bookkeeping costs more than the draw calls it
      // saves, and a batch of one is strictly worse than the mesh it replaces.
      if (members.length < MIN_BATCH_SIZE) continue;
      this.createBatch(key, members);
    }
  }

  /**
   * Gives a mesh back to itself, if it is still ours to give.
   *
   * A regroup visits the batches in creation order, and a mesh can move from
   * one that already exists to another that already exists — flipping
   * `castShadow` is enough, it is in the key. When the batch that *gains* it is
   * visited first, the batch that loses it comes to this point with the mesh
   * already re-homed, and handing it back unconditionally would undo that: the
   * mesh would be drawn by itself *and* as an instance, and with `slotOf`
   * cleared its instance would never be moved again — a ghost at the old
   * position that nothing updates.
   *
   * The old code could not reach this. Any membership change disposed both
   * batches and rebuilt them, which made the collision impossible by brute
   * force; making membership incremental took that away without replacing it.
   */
  private handBack(group: BatchGroup, mesh: Mesh): void {
    if (this.slotOf.get(mesh)?.group !== group) return;
    this.slotOf.delete(mesh);
    mesh.visible = true;
    // Back in the raycast too — see `hide`.
    mesh.layers.enable(RAYCAST_LAYER);
  }

  /**
   * Takes a mesh out of the picture its own object used to draw.
   *
   * Hidden rather than removed: it still carries the transform physics and
   * scripts move, and the batch reads its world matrix every frame.
   *
   * Out of the raycast layers as well, which `visible` alone does not do —
   * three's raycaster tests `layers` and nothing else, so a field of three
   * thousand batched crates was answering six thousand hit tests per click:
   * three thousand hidden meshes whose intersections `Picker` sorts by distance
   * and then throws away, and three thousand instances of the batch that
   * actually answers.
   */
  private hide(mesh: Mesh): void {
    mesh.visible = false;
    mesh.layers.disable(RAYCAST_LAYER);
  }

  /**
   * Makes a batch write its multi-draw list one more time.
   *
   * There is no public flag for it: the one `onBeforeRender` reads is raised
   * only by a change to an instance. Turning one instance invisible and
   * straight back leaves the batch exactly as it was — nothing renders in
   * between — and raises it.
   */
  private refreshDrawList(group: BatchGroup): void {
    const slot = group.bySlot.keys().next().value;
    if (slot === undefined) return;
    group.mesh.setVisibleAt(slot, false);
    group.mesh.setVisibleAt(slot, true);
  }

  /**
   * Brings an existing batch in line with what its key now holds, or says it
   * cannot.
   *
   * `deleteInstance` frees a slot id without moving any other, and `addInstance`
   * reuses freed ids first, so the members that stayed keep their slots, their
   * matrices and the answer `resolveBatchHit` gives for them.
   *
   * @returns Whether the group survives. `false` means the caller must dispose
   *   it and let the create pass build a new one.
   */
  private refit(group: BatchGroup, members: MeshHandle[]): boolean {
    /*
     * The batch draws **one** material object, chosen when it was built, and
     * nothing about the group's key can see that object move.
     *
     * `batchKey` names a material *asset* (or serialises an embedded
     * definition), so replacing what an asset id resolves to — a texture slot
     * changed, which is a different shader pipeline — leaves the key identical
     * while every member switches to a new object and the old one goes into the
     * retire queue. The next `beginFrame` frees it and the batch draws with a
     * destroyed pipeline.
     *
     * Asking whether any current member still holds it answers both that and
     * the embedded case, where the object belongs to whichever member happened
     * to be first and leaves the scene with it.
     */
    const drawn = group.mesh.material;
    if (!members.some((member) => member.material === drawn)) return false;

    /*
     * Nothing moved, which is the answer almost every time.
     *
     * A regroup runs on every frame of an inspector drag — `MeshSystem.patch`
     * invalidates unconditionally, and editing an embedded material changes its
     * serialised key — so this path is walked for three thousand meshes sixty
     * times a second to conclude that the group is what it was. It has to cost
     * nothing: the difference below allocates a `Set` and an array of N, where
     * this allocates neither. `meshHandles` yields in map insertion order, so an
     * untouched group always presents itself the same way round.
     */
    if (
      group.members.length === members.length &&
      group.members.every((member, index) => member.mesh === members[index]!.mesh)
    ) {
      return true;
    }

    const wanted = new Set(members.map((member) => member.mesh));
    const kept: { mesh: Mesh; slot: number }[] = [];
    for (const member of group.members) {
      if (wanted.has(member.mesh)) {
        kept.push(member);
        wanted.delete(member.mesh);
        continue;
      }
      group.mesh.deleteInstance(member.slot);
      group.bySlot.delete(member.slot);
      this.handBack(group, member.mesh);
    }

    // `maxInstanceCount` is fixed at construction, and `addInstance` throws
    // rather than growing. Over it, a rebuild is the only way to make room.
    if (kept.length + wanted.size > group.mesh.maxInstanceCount) return false;

    for (const mesh of wanted) {
      const slot = group.mesh.addInstance(group.geometryId);
      kept.push({ mesh, slot });
      group.bySlot.set(slot, mesh);
      this.slotOf.set(mesh, { group, slot });
      this.hide(mesh);
      // It holds an identity matrix until `sync` writes the real one.
      this.pending.push({ group, slot });
    }

    group.members = kept;
    group.mesh.name = `Batch(${kept.length})`;
    return kept.length > 0;
  }

  private createBatch(key: string, members: MeshHandle[]): void {
    const first = members[0]!;
    const position = first.geometry.getAttribute('position');
    const index = first.geometry.getIndex();

    /*
     * `BatchedMesh` rather than `InstancedMesh`, and the difference decided the
     * feature: an `InstancedMesh` is culled as one object, so a field of three
     * thousand rocks drew all of them whenever any was on screen — 4.8M
     * triangles against 51K for the same view unbatched, and slower for the
     * trouble. This culls per instance.
     *
     * **But only when nothing casts a shadow.** A `BatchedMesh` holds one
     * multi-draw list for the whole frame and rebuilds it in `onBeforeRender`,
     * i.e. once per camera — so the six faces of a point light's shadow map each
     * overwrite it, and the last one decides what the *colour* pass draws. With
     * a point light above four cubes, the list came out empty and all four
     * vanished; moving the light changed how many came back. That is B15 as
     * well, where a shadow frustum narrower than the field left 178 of 2000
     * crates on screen.
     *
     * So the culling is given up in exactly the scenes that cannot have it. A
     * large static field with no shadow-casting light — the case it was built
     * for — keeps it.
     */
    const batched = new BatchedMesh(
      headroomFor(members.length),
      position?.count ?? 0,
      index?.count ?? 0,
      first.material,
    );
    batched.castShadow = first.mesh.castShadow;
    batched.receiveShadow = first.mesh.receiveShadow;
    batched.perObjectFrustumCulled = this.shadowCasters.size === 0;

    /*
     * Sorting off, and it is what closes B15 rather than working around it.
     *
     * `onBeforeRender` returns early only when visibility, per-instance culling
     * and sorting are *all* off. Sorting is on by default, so the list was
     * rebuilt for every camera even in the scenes that had already surrendered
     * per-instance culling — the six shadow faces included, each one walking
     * every instance and sorting the result. With both off the list is written
     * once and no camera can overwrite it again.
     *
     * Front-to-back order buys overdraw only for transparent geometry, and
     * `batchKey` does not separate transparent from opaque — batching
     * transparency is a different question, not answered here.
     */
    batched.sortObjects = false;

    /*
     * And no whole-object culling, because three cannot be told when it went
     * stale. `setMatrixAt` writes the matrix texture and nothing else;
     * `Frustum.intersectsObject` computes `boundingSphere` the first time it
     * needs one and then keeps it forever. A batch whose instances move — under
     * physics, a script, or a gizmo drag — is culled against where they used to
     * be, and the whole field disappears at once.
     *
     * `perObjectFrustumCulled` is the culling worth having anyway: it recomputes
     * each instance's bounds every frame, so the object-level test was only ever
     * repeating it against a cached answer.
     */
    batched.frustumCulled = false;
    batched.name = `Batch(${members.length})`;

    const geometryId = batched.addGeometry(first.geometry);
    const slots: { mesh: Mesh; slot: number }[] = [];
    const bySlot = new Map<number, Mesh>();

    for (const build of members) {
      const slot = batched.addInstance(geometryId);
      slots.push({ mesh: build.mesh, slot });
      bySlot.set(slot, build.mesh);
      this.hide(build.mesh);
    }

    const group = { mesh: batched, geometryId, members: slots, bySlot };
    for (const { mesh, slot } of slots) {
      this.slotOf.set(mesh, { group, slot });
      // Every slot it just handed out holds an identity matrix.
      this.pending.push({ group, slot });
    }
    this.root.add(batched);
    this.batches.set(key, group);
  }

  private disposeBatch(key: string): void {
    const group = this.batches.get(key);
    if (!group) return;

    // Off screen now, freed later. `WebGPURenderer.render` returns a promise
    // the loop does not await, so a frame can still be encoding this object
    // when the next sync decides to drop it — and a destroyed index buffer
    // reaches the pass as `setIndexBuffer: parameter 1 is not of type
    // GPUBuffer`, which is a crash rather than a dropped frame.
    group.mesh.removeFromParent();
    this.arena.retire(group.mesh);

    // Guarded for the same reason a refit's departures are: another group may
    // already have taken this mesh over in this very regroup.
    for (const member of group.members) this.handBack(group, member.mesh);
    this.batches.delete(key);
  }

  /**
   * The entity a click on a batch landed on.
   *
   * A batch is one `Object3D`, so a raycast hit names the group and an instance
   * id rather than an entity. Only the member the slot holds can answer.
   */
  resolveBatchHit(object: Object3D, batchId: number): string | undefined {
    for (const group of this.batches.values()) {
      if (group.mesh !== object) continue;
      const mesh = group.bySlot.get(batchId);
      return mesh ? resolveEntityId(mesh) : undefined;
    }
    return undefined;
  }

  /**
   * Takes the batches down and gives their members back.
   *
   * Restoring visibility is the half that is easy to forget: without it,
   * turning batching off leaves four hundred hidden meshes and an empty scene.
   */
  clear(): void {
    for (const key of [...this.batches.keys()]) this.disposeBatch(key);
    // Taking the batches down says nothing about what the groups should hold,
    // so the next regroup has to run rather than trust its last answer.
    // Without this, turning batching off and on again left it off for good.
    this.dirty = true;
  }

  /**
   * Copies members' world matrices into their batch.
   *
   * Called every frame while a game runs: physics and scripts move the objects
   * directly rather than through the document, so nothing else would tell the
   * batch that anything moved.
   *
   * @param only Entity ids whose members are the only ones that moved. Omitted
   *   means all of them, which is what a running game needs — physics and
   *   scripts move objects without telling anyone. An editor sync knows exactly
   *   what changed, and writing 2000 matrices to move one cube was most of what
   *   a keystroke cost.
   */
  updateBatches(only?: ReadonlySet<string>): void {
    if (this.batches.size === 0) return;
    this.root.updateMatrixWorld(true);

    if (only === undefined) {
      for (const group of this.batches.values()) {
        for (const member of group.members) {
          group.mesh.setMatrixAt(member.slot, member.mesh.matrixWorld);
        }
      }
      return;
    }

    for (const id of only) {
      const view = this.reconciler.view(id);
      if (!view) continue;
      /*
       * The whole subtree, not the entity's own components.
       *
       * A dirty set names the entity a patch touched — `affectedEntities` reads
       * the id straight out of the patch path — and never its descendants.
       * Their world matrices do follow, because the walk above updates the
       * tree, but nothing was writing them into the batch: moving a parent left
       * its batched children drawn where they used to be until the next full
       * pass. The cost stays proportional to what moved.
       */
      view.container.traverse((object) => {
        const placed = this.slotOf.get(object);
        placed?.group.mesh.setMatrixAt(placed.slot, object.matrixWorld);
      });
    }
  }
}
