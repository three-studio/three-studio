import {
  createComponent,
  createEntity,
  createRenderingSettings,
  type ColliderComponent,
  type PlayerControllerComponent,
  type SceneDoc,
  type Vec3,
} from '@three-studio/core';
import { Euler, Object3D } from 'three/webgpu';
import { afterEach, describe, expect, it } from 'vitest';
import { sceneWith } from '../../../core/test/fixtures';
import { PlayerController } from '../../src/controllers/PlayerController';
import { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import { SceneBinder } from '../../src/SceneBinder';
import { studioTime } from '../../src/time/StudioTime';
import type { BehaviourContext } from '../../src/behaviour/Behaviour';
import type { Input } from '../../src/input/Input';

/*
 * The controller had no tests at all, and the two defects below were both
 * found by reading rather than by running — which is the whole argument for
 * this file existing.
 *
 * It is the first test in the project to start a physics world. Rapier's
 * `-compat` build inlines its WebAssembly, so `RAPIER.init()` resolves under
 * plain Node in well under a tenth of a second and needs nothing served. What
 * must never appear here, as in `sceneBinder.test.ts`, is a `WebGPURenderer`.
 */

const STEP = 1 / 60;

/**
 * Where a character is dropped from, a hand's width above the floor.
 *
 * **Not** flush with it. A capsule whose bottom starts exactly on `y = 0` is
 * pushed into the floor by `GROUNDED_STICK` faster than the solver lifts it
 * back out — which is the hazard that constant's own comment warns about — and
 * a shape that has penetrated is one Rapier will not move sideways at all. The
 * symptom is a character that takes a single step and then stands still, at
 * every speed above a walk, with nothing reported. Landing from just above is
 * both what a real scene does and what leaves the capsule resting on the
 * surface, 0.02 m up, where the controller keeps it.
 */
const STANDING_Y = 1;

/** A capsule 1.70 m tall, so its centre — the entity's origin — is 0.85 m up. */
function personCapsule(): ColliderComponent {
  return { ...createComponent('collider'), shape: 'capsule', radius: 0.3, halfHeight: 0.55 };
}

/**
 * `Input` binds to `window`, `document` and a DOM element, none of which exist
 * here. The controller reads this much of it and nothing else, so this declares
 * exactly that — the same narrow-shape trick `KeyEventLike` and
 * `AudioContextLike` use elsewhere in this package.
 *
 * `move` and `look` are what the on-screen sticks would be reporting. They are
 * plain fields a test writes to, because `Input` reads them off `TouchControls`
 * and `TouchControls` cannot exist here: nipplejs touches `window` while it is
 * being imported, which is the reason it is imported dynamically at all.
 */
interface StubInput {
  down: Set<string>;
  pointerLocked: boolean;
  move: { x: number; y: number };
  look: { x: number; y: number };
  touchActive: boolean;
  isDown(code: string): boolean;
  isAnyDown(...codes: string[]): boolean;
  consumeMouseDelta(): { x: number; y: number };
  consumeWheel(): number;
  moveAxis(): { x: number; y: number };
  lookAxis(): { x: number; y: number };
  enableTouch(): void;
}

function stubInput(): StubInput {
  const down = new Set<string>();
  const stub: StubInput = {
    down,
    pointerLocked: false,
    move: { x: 0, y: 0 },
    look: { x: 0, y: 0 },
    touchActive: false,
    isDown: (code) => down.has(code),
    isAnyDown: (...codes) => codes.some((code) => down.has(code)),
    consumeMouseDelta: () => ({ x: 0, y: 0 }),
    consumeWheel: () => 0,
    moveAxis: () => stub.move,
    lookAxis: () => stub.look,
    enableTouch: () => {},
  };
  return stub;
}

interface Rig {
  controller: PlayerController;
  object: Object3D;
  input: StubInput;
  /** Runs whole display frames, each carrying exactly one physics step. */
  run(seconds: number, onFrame?: () => void): void;
}

const live: { dispose(): void }[] = [];
afterEach(() => {
  while (live.length > 0) live.pop()?.dispose();
});

/**
 * A player standing in a world with a floor at `y = 0`.
 *
 * Everything real: a scene document, a bound scene graph, a Rapier world and
 * the controller the engine would build. The point of not faking the physics is
 * that the defect being pinned is *which* gravity reaches the character, and a
 * fake would have to answer that question itself.
 */
async function rigWith(gravity: Vec3, startY: number): Promise<Rig> {
  // Nothing but a collider: `describeCollider` reads a box's half extents from
  // the component, so the floor needs no geometry to stand on. Wide enough that
  // a character walking at full speed for a second is still on it — a metre of
  // floor would have turned every movement test into a fall.
  const ground = createEntity('Ground', [
    { ...createComponent('collider'), size: [20, 0.5, 20] as [number, number, number] },
  ]);
  ground.entity.transform.position = [0, -0.5, 0];

  const player = createEntity('Player', [
    createComponent('playerController'),
    personCapsule(),
    // What `addComponentWithDependencies` gives a player: the controller writes
    // the transform, so the body must not be solved for.
    { ...createComponent('rigidbody'), bodyType: 'kinematicPosition' as const },
  ]);
  player.entity.transform.position = [0, startY, 0];

  const scene: SceneDoc = sceneWith([ground, player]);
  const binder = new SceneBinder({
    resolver: { url: () => null },
    rendering: { ...createRenderingSettings(), batching: false },
  });
  binder.sync(scene);
  live.push(binder);

  const physics = await PhysicsWorld.create({ gravity, fixedTimestep: STEP, maxSubsteps: 5 });
  physics.build(scene, binder);
  live.push(physics);

  const object = binder.getObject(player.entity.id);
  if (!object) throw new Error('the player was not bound');

  const input = stubInput();
  const ctx = {
    scene,
    binder,
    physics,
    input: input as unknown as Input,
    time: studioTime,
    scenes: null,
    audio: null,
    warn: () => {},
  } satisfies BehaviourContext;

  const controller = new PlayerController(
    player.components[0] as PlayerControllerComponent,
    object,
    physics,
    player.entity.id,
    personCapsule(),
  );

  return {
    controller,
    object,
    input,
    run(seconds, onFrame) {
      for (let frame = 0; frame < Math.round(seconds / STEP); frame++) {
        controller.update(STEP, ctx);
        physics.step(STEP, (fixed) => controller.fixedUpdate(fixed, ctx));
        controller.postUpdate();
        onFrame?.();
      }
    },
  };
}

describe('PlayerController falls at the world it is in', () => {
  /** How far the character drops in one second of free fall, started high up. */
  async function dropIn(gravity: number): Promise<number> {
    const rig = await rigWith([0, gravity, 0], 50);
    const before = rig.object.position.y;
    rig.run(1);
    return before - rig.object.position.y;
  }

  it('scales the fall with the project gravity instead of assuming Earth', async () => {
    // The defect: `const GRAVITY = 9.81` was written into the controller while
    // every other body in the scene read `PhysicsSettings.gravity`. Changing a
    // project's gravity moved everything except the player.
    //
    // Asserted as a ratio rather than a closed form because the integration is
    // Euler and discrete: what has to hold is that the fall is *linear in the
    // world's gravity*, which is exactly what a hard-coded constant breaks —
    // with the bug these two numbers are identical.
    const mars = await dropIn(-3.71);
    const earth = await dropIn(-9.81);

    expect(mars / earth).toBeCloseTo(3.71 / 9.81, 3);
    expect(mars).toBeLessThan(earth);
  });

  /**
   * Jumps, and reports the flight: how high above the resting height it got,
   * and for how many frames it was clear of the floor.
   */
  async function jumpIn(gravity: number): Promise<{ apex: number; airborne: number }> {
    const rig = await rigWith([0, gravity, 0], STANDING_Y);
    rig.run(0.5); // Land and settle, so the jump is allowed at all.

    const resting = rig.object.position.y;
    rig.input.down.add('Space');

    let apex = 0;
    let airborne = 0;
    rig.run(1.5, () => {
      const height = rig.object.position.y - resting;
      apex = Math.max(apex, height);
      if (height > 0.1) airborne += 1;
      // Held for one frame only: the controller latches the request, and a key
      // left down would jump again the moment it landed.
      rig.input.down.delete('Space');
    });
    return { apex, airborne };
  }

  it('leaves the ground, rather than hopping for a single step', async () => {
    // Rapier answers `computedGrounded()` from the contact its solve began
    // with, so the frame a jump is issued comes back grounded however far up
    // the movement went. The tick after that used to see `grounded`, overwrite
    // the jump velocity with the downward stick, and let snap-to-ground pull
    // the character straight back: a 1.2 m jump reached 0.0497 m — one step of
    // the initial velocity, and nothing more.
    const { apex, airborne } = await jumpIn(-9.81);

    expect(apex).toBeGreaterThan(1);
    // The measure that a one-step hop cannot fake, whatever the numbers.
    expect(airborne).toBeGreaterThan(20);
  });

  it('still reaches the configured jump height on another planet', async () => {
    // `v = sqrt(2gh)` makes the apex `h` whatever `g` is — provided the `g` in
    // the impulse is the `g` in the fall. With the hard-coded constant it was
    // not, and a 1.2 m jump on Mars would carry to nearly 3.2 m.
    const { apex } = await jumpIn(-3.71);

    expect(apex).toBeCloseTo(createComponent('playerController').jumpHeight, 1);
  });

  for (const [name, gravity] of [
    ['weightless', 0],
    ['pulling upward', 9.81],
  ] as const) {
    it(`jumps to nowhere rather than to NaN when the world is ${name}`, async () => {
      // `Math.sqrt(2gh)` with a `g` that does not pull down is `NaN`, and a
      // `NaN` reaching `setNextKinematicTranslation` teleports the body out of
      // the world with nothing reported anywhere. Clamping at zero is the
      // honest answer: with no downward pull there is no height to jump to.
      const rig = await rigWith([0, gravity, 0], 0.85);
      rig.run(0.25);
      rig.input.down.add('Space');
      rig.run(0.5);

      expect(Number.isFinite(rig.object.position.y)).toBe(true);
      expect(Number.isFinite(rig.controller.camera.position.y)).toBe(true);
    });
  }
});

describe('PlayerController places the eye above the feet', () => {
  /** No physics: the camera is placed from the transform and the collider. */
  function eyeAbove(groundY: number, eyeHeight: number, collider?: ColliderComponent): number {
    const object = new Object3D();
    object.position.set(0, groundY, 0);
    const component = { ...createComponent('playerController'), eyeHeight };
    const controller = new PlayerController(component, object, null, 'player', collider);
    controller.postUpdate();
    return controller.camera.position.y;
  }

  it('measures from the bottom of the capsule, not from the entity origin', () => {
    // The origin is the capsule's middle — physics centres a shape on its body
    // — so an entity standing on `y = 0` has its origin at 0.85. Asking for an
    // eye at 1.65 used to put the camera at 2.50.
    expect(eyeAbove(0.85, 1.65, personCapsule())).toBeCloseTo(1.65, 6);
  });

  it('measures a box from its half extent', () => {
    // The shape a bare entity used to be given, and the reason the default
    // player's eye sat at 2.2 m on a character one metre tall.
    const box: ColliderComponent = { ...createComponent('collider') };
    expect(eyeAbove(0.5, 1.6, box)).toBeCloseTo(1.6, 6);
  });

  it('treats the origin as the feet when there is no collider', () => {
    // Fly mode, and an entity nobody gave a shape: with nothing centred on the
    // origin, the origin is already the reference.
    expect(eyeAbove(0, 1.6)).toBeCloseTo(1.6, 6);
  });

  it('takes the field of view from the component, and follows it', () => {
    const object = new Object3D();
    const component = { ...createComponent('playerController'), fov: 85 };
    const controller = new PlayerController(component, object, null, 'player', undefined);

    expect(controller.camera.fov).toBe(85);

    component.fov = 60;
    controller.postUpdate();
    expect(controller.camera.fov).toBe(60);
  });
});

/*
 * The on-screen sticks, seen from the side the controller reads them.
 *
 * `TouchControls` itself is not here and cannot be: nipplejs builds its factory
 * while the module is evaluated and that constructor touches `window`, so
 * importing it under Node throws. What is testable is the whole of what the
 * controller does with two numbers, which is the part that decides how the game
 * feels — and `touchMath.test.ts` covers the arithmetic that produces them.
 */
describe('PlayerController driven by the sticks', () => {
  /** Ground covered in a second, starting from rest on the floor. */
  async function walkedWith(
    stick: { x: number; y: number },
    keys: readonly string[] = [],
  ): Promise<number> {
    const rig = await rigWith([0, -9.81, 0], STANDING_Y);
    rig.run(0.5); // Land and settle, so the first frames are not a fall.

    const from = { x: rig.object.position.x, z: rig.object.position.z };
    rig.input.touchActive = true;
    rig.input.move = stick;
    for (const key of keys) rig.input.down.add(key);
    rig.run(1);

    return Math.hypot(rig.object.position.x - from.x, rig.object.position.z - from.z);
  }

  it('walks at the fraction of the speed the stick is asking for', async () => {
    // The whole point of not normalising the stick: a thumb held halfway is a
    // walk, not a run at half the frame rate. Asserted as a ratio because the
    // solver shaves a little off both, and the ratio is what has to hold.
    const full = await walkedWith({ x: 0, y: 1 });
    const part = await walkedWith({ x: 0, y: 0.4 });

    expect(part / full).toBeCloseTo(0.4, 1);
  });

  it('lets the stick overrule the keyboard rather than summing with it', async () => {
    // A hybrid machine has both. Adding them would let a player hold W with a
    // thumb on the stick and walk at 1.7× — found by whoever speedruns the
    // level, not by whoever wrote this.
    const forwardOnly = await walkedWith({ x: 0, y: 1 });
    const contradicted = await walkedWith({ x: 0, y: 1 }, ['KeyS']);

    expect(contradicted).toBeCloseTo(forwardOnly, 1);
  });

  it('turns the camera at the look speed, with no pointer lock anywhere', async () => {
    /*
     * The guard used to be `if (!input.pointerLocked) return`, and there is no
     * pointer lock on a phone: the camera was welded in place with a stick
     * under the thumb doing nothing at all.
     *
     * A stick is a **rate**, so a second at full deflection is exactly
     * `touchLookSpeed` radians — which is also what says the term is integrated
     * over the frame rather than treated as a displacement.
     */
    const rig = await rigWith([0, -9.81, 0], STANDING_Y);
    rig.input.touchActive = true;
    rig.input.look = { x: 1, y: 0 };

    const before = yawOf(rig.controller);
    rig.run(1);

    const speed = createComponent('playerController').touchLookSpeed;
    expect(before - yawOf(rig.controller)).toBeCloseTo(speed, 1);
  });

  it('leaves the camera alone when the sticks are not up', async () => {
    // Without the `touchActive` half of the guard this would turn: the stub
    // reports a deflection whatever the state of the overlay.
    const rig = await rigWith([0, -9.81, 0], STANDING_Y);
    rig.input.look = { x: 1, y: 0 };

    const before = yawOf(rig.controller);
    rig.run(1);

    expect(yawOf(rig.controller)).toBeCloseTo(before, 6);
  });
});

/** The yaw the controller is holding, read back off the camera it places. */
function yawOf(controller: PlayerController): number {
  // The same order `placeCamera` writes with; the default XYZ would mix the
  // pitch into the number this asks for.
  return new Euler().setFromQuaternion(controller.camera.quaternion, 'YXZ').y;
}
