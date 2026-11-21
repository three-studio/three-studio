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
import { audioOf } from '../src/audio/audioOf';
import { Behaviour } from '../src/scripting/ScriptHost';
import { rig as audioRig } from './audio/rig';
import {
  block,
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
 * What a running world allocates per frame in this repository's own code, and
 * in Rapier's.
 *
 * Garbage made every frame is paid for in collections, and a collection is a
 * frame the player sees stutter. three makes some of its own, which the
 * performance harness reports; what is held here is what this repository
 * writes, and what Rapier makes for it: every kernel subsystem at work on a
 * scene that uses each of them, a thousand boxes asleep among them, as a
 * level's props are most of the time, sampled by V8's heap profiler once the
 * scene has settled, every byte charged to the function that allocated it.
 *
 * It is held to budgets rather than to zero because what is left is not ours
 * to write away. V8 boxes a fraction it passes to a function it did not
 * inline, sixteen bytes each time. Rapier's bindings make a typed array for
 * each pose read, whatever it is read into, charged to the physics function
 * that reads it; and each step reads the host's clock 36 times, its profiler
 * off, some 2.7 KB a step. Each budget sits a little above what a frame
 * allocates today, so that a closure or an object made every frame breaks it,
 * and so does a call into Rapier for each body.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

/** Frames sampled, once the scene has settled. */
const FRAMES = 3000;

/**
 * Frames sampled first. A frame of hundreds of kilobytes — Rapier remapping
 * every handle, a thousand bodies read — sampled over every frame makes a
 * profile past the longest string V8 can build, and swapped the machine to a
 * halt on its way, with 18 GB of swap. Such a frame fails here.
 */
const GLANCE = 30;

/** Bytes a frame may allocate in physics' functions, Rapier's bindings inlined in them: the player's, mostly. */
const PHYSICS_BUDGET = 448;

/** Bytes a frame may allocate in every other function of ours. */
const BUDGET = 128;

/** Bytes a frame may allocate in Rapier's own functions, those V8 did not inline into ours: its clock, mostly. */
const RAPIER_BUDGET = 3584;

/** How a site is named in the report when it is a function of Rapier's build. */
const RAPIER = 'rapier3d-compat';

/** The budgets a site of the report counts against. */
type Part = 'ours' | 'physics' | 'rapier';

function partOf(where: string): Part {
  if (where.startsWith(`${RAPIER} `)) return 'rapier';
  return where.includes('/src/physics/') ? 'physics' : 'ours';
}

/** Every node of a heap profile's tree, its root first. */
function* nodesOf(node: HeapProfiler.SamplingHeapProfileNode): Generator<HeapProfiler.SamplingHeapProfileNode> {
  yield node;
  for (const child of node.children) yield* nodesOf(child);
}

/** The file of a package's or a module's source a script is, `RAPIER` for Rapier's build, or null for anything else. */
function fileOf(url: string): string | null {
  if (url.includes('/@dimforge/rapier3d-compat/')) return RAPIER;
  const at = url.search(/\/(packages|modules)\/[^/]+\/src\//);
  return at < 0 ? null : url.slice(at + 1);
}

/** The bytes each function of ours, and each of Rapier's build, allocated while sampled, the heaviest first. */
function allocations(head: HeapProfiler.SamplingHeapProfileNode): [where: string, bytes: number][] {
  const bytes = new Map<string, number>();
  for (const { callFrame, selfSize } of nodesOf(head)) {
    const file = fileOf(callFrame.url);
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
  it('allocates no more per frame than its budgets, ours and Rapier’s', { timeout: 30_000 }, async () => {
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
    // A thousand boxes dropped onto a floor of their own, away from the rest:
    // falling through the warm-up, asleep when sampled, as a level's props are
    // most of the time.
    const field = block([100, -0.5, 0], [60, 1, 60]);
    const dropped = Array.from({ length: 1000 }, (_, i) =>
      withBody('box', [100 + (i % 32) * 1.5 - 23.25, 2, Math.floor(i / 32) * 1.5 - 23.25]),
    );
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
      field,
      ...dropped,
    ]);
    const step = rig.world.fixedStep;

    // Settled: the bodies at rest, the clip decoded and playing, every
    // function the frame calls compiled. The ear unlocked first: the source
    // starts as the world starts, at the end of `World.play`, and its voice
    // plays once its clip has landed, which takes turns of the event loop the
    // frames below do not give — unlocked after them, the voice began playing
    // as sampling began, and its frame's code was compiled while sampled.
    await audio.engine.unlock();
    for (let frame = 0; frame < 1000; frame += 1) rig.world.frame(step);
    // What the frames below measure: a voice playing, placed every frame.
    expect(audioOf(rig.world)?.voices.map((voice) => voice.state)).toEqual(['playing']);

    const session = new Session();
    session.connect();
    try {
      await session.post('HeapProfiler.enable');
      /** Each part's bytes a frame over `frames` sampled frames, and every site's. */
      const sample = async (frames: number) => {
        await session.post('HeapProfiler.startSampling', {
          samplingInterval: 64,
          includeObjectsCollectedByMajorGC: true,
          includeObjectsCollectedByMinorGC: true,
        });
        for (let frame = 0; frame < frames; frame += 1) rig.world.frame(step);
        const { profile } = await session.post('HeapProfiler.stopSampling');
        const sites = allocations(profile.head);
        const perFrame = (part: Part) =>
          sites.reduce((sum, [where, bytes]) => (partOf(where) === part ? sum + bytes : sum), 0) / frames;
        const report = sites.map(([where, bytes]) => `${(bytes / frames).toFixed(1)} B/frame  ${where}`).join('\n');
        return { ours: perFrame('ours'), physics: perFrame('physics'), rapier: perFrame('rapier'), report };
      };

      const glance = await sample(GLANCE);
      expect(glance.ours + glance.physics + glance.rapier, glance.report).toBeLessThan(
        4 * (BUDGET + PHYSICS_BUDGET + RAPIER_BUDGET),
      );
      // Sampling moves what V8 inlines, and with it where a byte is charged:
      // the frames below are compiled again before they are sampled.
      for (let frame = 0; frame < 500; frame += 1) rig.world.frame(step);

      const sampled = await sample(FRAMES);
      expect(sampled.ours, sampled.report).toBeLessThanOrEqual(BUDGET);
      expect(sampled.physics, sampled.report).toBeLessThanOrEqual(PHYSICS_BUDGET);
      expect(sampled.rapier, sampled.report).toBeLessThanOrEqual(RAPIER_BUDGET);
    } finally {
      await session.post('HeapProfiler.disable');
      session.disconnect();
    }
  });
});
