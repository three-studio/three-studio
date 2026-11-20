import {
  colliderGeometry,
  componentsOfType,
  entitiesWith,
  findComponent,
  findComponents,
  hasComponent,
  jointEnds,
  layersTouch,
  linkedPhysicsMaterial,
  physicsBodies,
  type AssetId,
  type EntityId,
  type JointComponent,
  type PhysicsMaterialDef,
  type PhysicsSettings,
  type SceneDoc,
} from '@three-studio/core';
import type { SceneBinder } from '../SceneBinder';
import { ownMeshes } from './meshShape';

/** What physics' diagnostics read: the scene it was built from, and how. */
export interface PhysicsSetup {
  readonly scene: SceneDoc;
  readonly settings: PhysicsSettings;
  /** The project's physics materials by asset id, which the colliders were built with. */
  readonly materials: ReadonlyMap<AssetId, PhysicsMaterialDef>;
  /** The scene's objects, whose own meshes a mesh collider is built from. */
  readonly binder: SceneBinder;
  /** The entities somebody listens on for collisions: physics' channel's. */
  readonly listening: readonly EntityId[];
}

/**
 * Set-ups that will not behave as the author expects, each said as a line.
 *
 * Every case here fails silently at runtime — a player with no collider just
 * flies, a rigid body with no collider just passes through the floor — which
 * makes them the hardest kind of mistake to find. Naming the entity and the
 * fix costs nothing and turns a mystery into a one-line correction.
 */
export function physicsSetupProblems({ scene, settings, materials, binder, listening }: PhysicsSetup): string[] {
  // Over the bodies the world builds, so the two cannot disagree: a body
  // whose colliders are on its children was warned about as having none.
  const bodies = physicsBodies(scene);
  const players = new Set(entitiesWith(scene, 'playerController'));
  // Which body each collider rides: the one whose type it is built for.
  const riding = new Map<EntityId, EntityId>();
  for (const [body, carried] of bodies) {
    for (const entityId of carried) riding.set(entityId, body);
  }
  const problems: string[] = [];
  const warn = (problem: string): void => void problems.push(problem);

  // A mesh-derived collider on an entity with nothing to derive from falls
  // back to a box 2 cm across, which a player walks straight past. It
  // happened for real: physics used to be built before the glTF arrived.
  // That is fixed, but a model that fails to load reaches the same place,
  // and silently.
  for (const [entityId, bodyId] of riding) {
    const entity = scene.entities.get(entityId);
    if (!entity) continue;
    const meshes = findComponents(scene, entityId, 'collider').filter(
      (component) => component.shape.kind === 'mesh',
    );
    if (meshes.length === 0) continue;

    // Triangles on a dynamic body are built as their hull, which fills in
    // the very holes the author may have chosen triangles to keep. The body
    // may be a parent's, which is then the one to name.
    const bodyType = findComponent(scene, bodyId, 'rigidbody')?.bodyType;
    const hulled = meshes.some(({ shape }) => {
      const built = colliderGeometry(shape, [1, 1, 1], bodyType).shape;
      return shape.kind === 'mesh' && built.kind === 'mesh' && built.build !== shape.build;
    });
    if (hulled) {
      const body =
        bodyId === entityId ? 'its Rigid Body' : `the Rigid Body of "${scene.entities.get(bodyId)?.name}"`;
      warn(
        `"${entity.name}" moves with physics, so its mesh Collider is built as its convex hull rather than from its triangles: holes and hollows are filled in. Choose Convex parts to keep them, Convex hull to say so, or make ${body} Kinematic or Fixed.`,
      );
    }

    // Its own meshes alone: a group's children draw theirs. Moved, not
    // copied: given to its children and kept, it is still the tiny box.
    const object = binder.getObject(entityId);
    if (!object || ownMeshes(object).length === 0) {
      warn(
        `"${entity.name}" has a mesh Collider but draws no mesh of its own, so it is a tiny box nothing can stand on. A Collider is built from its own entity's meshes, not its children's: move it onto each child that should collide, or check that its model loaded.`,
      );
    }
  }

  // Something declares physics and has nothing to collide with. An empty
  // list is a Rigid Body's, level geometry being a collider's own; a player
  // is said by what it lacks itself.
  for (const [entityId, carried] of bodies) {
    const entity = scene.entities.get(entityId);
    if (!entity || carried.length > 0 || players.has(entityId)) continue;
    warn(
      `"${entity.name}" has a Rigid Body but no Collider, on it or on a child without a body of its own, so nothing can touch it. Add a Collider.`,
    );
  }
  // Its own: a character sweeps its entity's collider, never one riding its
  // body from a child.
  for (const entityId of players) {
    const entity = scene.entities.get(entityId);
    if (!entity || hasComponent(scene, entityId, 'collider')) continue;
    warn(
      `"${entity.name}" has a Player Controller but no Collider, so it flies instead of walking. Add a Collider.`,
    );
  }

  // A player's own capsule is not something to stand on, and counting it
  // was a false negative that hid the whole point of the check: a scene
  // whose only collider was the player's said nothing while the player fell
  // for ever. Nor is anything riding the player's body, which moves with it.
  const hasGround = [...bodies].some(([entityId, carried]) => carried.length > 0 && !players.has(entityId));
  if (players.size > 0 && !hasGround) {
    warn(
      'Nothing but the player has a Collider, so there is no ground to stand on. Add a Collider to whatever the player should walk on.',
    );
  } else {
    // Nor is a sensor, nor a collider whose layer the player's passes
    // through. Unticking a pair while trying the matrix out is the quickest
    // way to a player that falls for ever, and nothing else says why.
    const solid = [...riding].flatMap(([entityId, body]) =>
      findComponents(scene, entityId, 'collider')
        .filter((collider) => !collider.isSensor)
        .map(({ layer }) => ({ body, layer })),
    );
    for (const entityId of players) {
      const entity = scene.entities.get(entityId);
      // The collider its character sweeps.
      const own = findComponent(scene, entityId, 'collider');
      if (!entity || !own) continue;
      const stands = solid.some(
        ({ body, layer }) => body !== entityId && layersTouch(settings.layers, own.layer, layer),
      );
      if (stands) continue;
      const name = settings.layers.find((layer) => layer.id === own.layer)?.name ?? 'Default';
      warn(
        `"${entity.name}" is on the layer "${name}", which touches the layer of no other Collider, so it falls through everything. Tick "${name}" against the ground's layer in Project Settings ▸ Physics.`,
      );
    }
  }

  // A collider naming a layer the table no longer has collides as Default,
  // and its Layer row only shows no choice. Removing a layer rewrites no
  // scene: the others are on disk.
  const layerIds = new Set(settings.layers.map((layer) => layer.id));
  for (const entityId of riding.keys()) {
    const entity = scene.entities.get(entityId);
    const colliders = findComponents(scene, entityId, 'collider');
    if (!entity || colliders.every((collider) => layerIds.has(collider.layer))) continue;
    warn(
      `"${entity.name}" has a Collider on a layer this project no longer has, so it collides as Default. Choose its Layer again.`,
    );
  }

  // A link to a physics material the project lacks plays the collider's own
  // values. The hierarchy marks it while editing; a device and a build have
  // no hierarchy, and a puck that grips where it was made to slide gives no
  // reason. `''` is a slot left empty, not a link.
  for (const entityId of riding.keys()) {
    const entity = scene.entities.get(entityId);
    const colliders = findComponents(scene, entityId, 'collider');
    const lost = colliders.some(
      ({ materialId }) => !!materialId && linkedPhysicsMaterial(materialId, materials) === null,
    );
    if (!entity || !lost) continue;
    warn(
      `"${entity.name}" has a Collider whose physics material is not in this project, so it grips and bounces by its own values. Choose its Material again.`,
    );
  }

  // A joint the world left out is dropped silently, and one holding no body
  // the solver moves is built and does nothing: a door falls off its hinge,
  // or a gate on a Kinematic body never swings, and nothing else says why.
  // Read through the rule the build reads.
  for (const [entityId, held] of componentsOfType(scene, 'joint')) {
    for (const joint of held.values()) {
      const problem = joint.type === 'joint' ? jointProblem(scene, entityId, joint) : null;
      if (problem) warn(problem);
    }
  }

  // A listener hears through its entity's colliders, or a body's through
  // those of the children riding it: on an entity with neither it hears
  // nothing, and nothing says why. A Rigid Body with no collider anywhere is
  // said above.
  for (const entityId of listening) {
    const entity = scene.entities.get(entityId);
    if (!entity || hasComponent(scene, entityId, 'collider') || hasComponent(scene, entityId, 'rigidbody')) {
      continue;
    }
    warn(
      `"${entity.name}" listens for collisions or triggers but has no Collider and no Rigid Body, so it never hears one. Add a Collider to it, or move the script onto the entity that has one.`,
    );
  }

  return problems;
}

/** What keeps a joint from doing its work, said as `physicsSetupProblems` says it, or `null`. */
function jointProblem(scene: SceneDoc, entityId: EntityId, joint: JointComponent): string | null {
  const name = scene.entities.get(entityId)?.name;
  const other = joint.connectedEntity === null ? undefined : scene.entities.get(joint.connectedEntity)?.name;
  const ends = jointEnds(scene, entityId, joint);
  if (!ends.holds) {
    switch (ends.why) {
      case 'gone':
        return `"${name}" has a Joint whose Connected Body is not in this scene, so it holds nothing. Choose its Connected Body again, or World to hold it to the world.`;
      case 'noBody':
        return `"${name}" has a Joint but moves with no body, so it holds nothing. Add a Rigid Body to it or to an entity above it.`;
      case 'otherNoBody':
        return `"${name}"'s Joint is connected to "${other}", which moves with no body, so it holds nothing. Give "${other}" a Rigid Body or a Collider, or choose World to hold "${name}" to the world.`;
      case 'same':
        return `"${name}"'s Joint is connected to "${other}", which moves with the same body, so it holds nothing. Choose another Connected Body.`;
    }
  }
  // The world is not Dynamic, and two Fixed bodies joined are harmless to build.
  const dynamic = (bodyId: EntityId | null) =>
    bodyId !== null && findComponent(scene, bodyId, 'rigidbody')?.bodyType === 'dynamic';
  if (dynamic(ends.own) || dynamic(ends.other)) return null;
  return `"${name}"'s Joint holds no Dynamic body, so it moves nothing. Make the Rigid Body of "${scene.entities.get(ends.own)?.name}" or of what it is connected to Dynamic.`;
}
