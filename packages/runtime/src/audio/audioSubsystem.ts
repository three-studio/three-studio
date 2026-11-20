import { entitiesWith, fixedId, type Disposable } from '@three-studio/core';
import { EarPose } from '../behaviour/audio';
import type { Subsystem, SubsystemDefinition, World } from '../world/World';
import { AudioEngine } from './AudioEngine';
import { provideAudio } from './audioOf';

/**
 * Everything a world plays: its engine, made on the host's audio context, the
 * voices it retires once a frame, and the ear when no entity carries one.
 */
export const audioSubsystem: SubsystemDefinition = {
  id: fixedId('subsystem', 'audio'),
  // After the behaviours' late hooks: a listener riding the player is placed
  // where the player ended the frame, and the camera the ear falls back to is
  // where its controller left it.
  order: { lateUpdate: 100 },
  create(world) {
    const { audioContext, audioCache, assets } = world.options;
    // No context, no sound: a test, or a browser with no Web Audio. Nothing to
    // run, and `audioOf` answers `null`, which every audio behaviour declines.
    if (audioContext === undefined) return { dispose() {} };
    const audio = new AudioEngine({
      context: audioContext,
      resolver: assets.resolver,
      cache: audioCache,
      onWarning: world.warn,
    });
    return new AudioSubsystem(world, audio);
  },
};

class AudioSubsystem implements Subsystem {
  /**
   * How many entities carry an Audio Listener. None puts the ear on the camera
   * the game is drawn through, which is right far more often than it is wrong
   * and much better than a silent scene; several is said.
   */
  private readonly listeners: number;
  private readonly ear = new EarPose();
  private readonly provided: Disposable;

  constructor(
    private readonly world: World,
    private readonly audio: AudioEngine,
  ) {
    this.listeners = entitiesWith(world.document, 'audioListener').length;
    this.provided = provideAudio(world, audio);
  }

  lateUpdate(): void {
    if (this.listeners === 0) this.ear.place(this.audio, this.world.cameras.active);
    this.audio.update();
  }

  diagnose(): readonly string[] {
    // With several, the first to write each frame wins, and saying so is the
    // whole value of the line: two ears is a bug that sounds like a mixing
    // problem.
    if (this.listeners < 2) return [];
    return [
      `${this.listeners} entities carry an Audio Listener; only one ear is placed and the others are ignored.`,
    ];
  }

  dispose(): void {
    this.provided.dispose();
    this.audio.dispose();
  }
}
