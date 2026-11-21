import {
  audioSourceType,
  createCameraEntity,
  createEntity,
  createLightEntity,
  createMeshEntity,
  fixedId,
} from '@three-studio/core';
import type { HeapProfiler } from 'node:inspector';
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AudioListenerLike, AudioParamLike } from '../src/audio/AudioContextLike';
import { Behaviour } from '../src/scripting/ScriptHost';
import { rig as audioRig } from './audio/rig';
import {
  ground,
  physicsRigOn,
  player,
  standInForTheBrowser,
  takeTheBrowserBack,
  withBody,
  withScript,
} from './physics/rig';
import { builtInRegistries } from './registries';

/*
 * What a running world allocates per frame in this repository's own code.
 *
 * Garbage made every frame is paid for in collections, and a collection is a
 * frame the player sees stutter. three and Rapier make some of their own,
 * which the performance harness reports; what is held here is what this
 * repository writes: every kernel subsystem at work on a scene that uses each
 * of them, sampled by V8's heap profiler once the scene has settled, every
 * byte charged to the function that allocated it.
 *
 * It is held to a budget rather than to zero because what is left is not ours
 * to write away. V8 boxes a fraction it passes to a function it did not
 * inline, sixteen bytes each time; and Rapier's bindings, which V8 inlines
 * into the physics functions that call them, allocate on most calls — nearly
 * all of the physics share. Each budget sits a little above what a frame
 * allocates today, so that a closure or an object made every frame breaks it.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

/** Frames sampled, once the scene has settled. */
const FRAMES = 3000;

/** Bytes a frame may allocate in physics' functions, Rapier's bindings inlined in them. */
const PHYSICS_BUDGET = 1024;

/** Bytes a frame may allocate in every other function of ours. */
const BUDGET = 128;

/** Every node of a heap profile's tree, its root first. */
function* nodesOf(node: HeapProfiler.SamplingHeapProfileNode): Generator<HeapProfiler.SamplingHeapProfileNode> {
  yield node;
  for (const child of node.children) yield* nodesOf(child);
}

/** The file of a package's or a module's source a script is, or null for a test's or a dependency's. */
function ownFile(url: string): string | null {
  const at = url.search(/\/(packages|modules)\/[^/]+\/src\//);
  return at < 0 ? null : url.slice(at + 1);
}

/** The bytes each function of ours allocated while sampled, the heaviest first. */
function allocations(head: HeapProfiler.SamplingHeapProfileNode): [where: string, bytes: number][] {
  const bytes = new Map<string, number>();
  for (const { callFrame, selfSize } of nodesOf(head)) {
    const file = ownFile(callFrame.url);
    if (file === null || selfSize === 0) continue;
    const where = `${file} ${callFrame.functionName || '(anonymous)'}`;
    bytes.set(where, (bytes.get(where) ?? 0) + selfSize);
  }
  return [...bytes].sort((a, b) => b[1] - a[1]);
}

/** A parameter that keeps its value and records nothing. */
class QuietParam implements AudioParamLike {
  value = 0;

  setValueAtTime(value: number): AudioParamLike {
    this.value = value;
    return this;
  }

  linearRampToValueAtTime(value: number): AudioParamLike {
    this.value = value;
    return this;
  }

  cancelScheduledValues(): AudioParamLike {
    return this;
  }
}

function quietListener(): AudioListenerLike {
  return {
    positionX: new QuietParam(),
    positionY: new QuietParam(),
    positionZ: new QuietParam(),
    forwardX: new QuietParam(),
    forwardY: new QuietParam(),
    forwardZ: new QuietParam(),
    upX: new QuietParam(),
    upY: new QuietParam(),
    upZ: new QuietParam(),
  };
}

describe('a running world', () => {
  it('allocates no more per frame than its budget in this repository’s code', async () => {
    const hum = fixedId('asset', 'hum');
    const audio = audioRig({ hum: { duration: 2 } }, { shareCache: true });
    // An ear whose parameters keep a value and nothing else: the fake's own
    // record of every call is the fake's allocation, which V8 would charge to
    // the runtime's functions it is inlined into.
    audio.context.listener = quietListener();

    class Busy extends Behaviour {
      override onUpdate() {}
      override onFixedUpdate() {}
      override onLateUpdate() {}
      override onCollisionEnter() {}
    }
    const crates = [0, 1, 2].map((i) => withBody('box', [i * 2 - 2, 0.5, -3]));
    const scripted = withScript(withBody('sphere', [3, 0.5, 0]), Busy);
    const speaker = createEntity('Speaker', [
      { ...audioSourceType.create(), assetId: hum, playOnStart: true, loop: true, spatialBlend: 1 },
    ]);
    const boxes = [0, 1, 2, 3, 4].map((i) => {
      const box = createMeshEntity('box');
      box.entity.transform.position = [i * 2 - 4, 0.5, 4];
      return box;
    });
    const rig = await physicsRigOn(builtInRegistries(), {
      audioContext: audio.context,
      audioCache: audio.cache,
      batching: true,
    })([
      ground(),
      ...crates,
      scripted,
      player([0, 1, 0]),
      speaker,
      createCameraEntity(),
      createLightEntity('directional'),
      ...boxes,
    ]);
    const step = rig.world.fixedStep;

    // Settled: the bodies at rest, the clip decoded and playing, every
    // function the frame calls compiled.
    for (let frame = 0; frame < 1000; frame += 1) rig.world.frame(step);
    await audio.engine.unlock();

    const session = new Session();
    session.connect();
    try {
      await session.post('HeapProfiler.enable');
      await session.post('HeapProfiler.startSampling', {
        samplingInterval: 64,
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true,
      });
      for (let frame = 0; frame < FRAMES; frame += 1) rig.world.frame(step);
      const { profile } = await session.post('HeapProfiler.stopSampling');

      const sites = allocations(profile.head);
      const perFrame = (physics: boolean) =>
        sites.reduce((sum, [where, bytes]) => (where.includes('/src/physics/') === physics ? sum + bytes : sum), 0) / FRAMES;
      const report = sites.map(([where, bytes]) => `${(bytes / FRAMES).toFixed(1)} B/frame  ${where}`).join('\n');

      expect(perFrame(false), report).toBeLessThanOrEqual(BUDGET);
      expect(perFrame(true), report).toBeLessThanOrEqual(PHYSICS_BUDGET);
    } finally {
      await session.post('HeapProfiler.disable');
      session.disconnect();
    }
  });
});
