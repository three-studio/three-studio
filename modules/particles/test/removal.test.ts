import {
  createEntity,
  createMeshEntity,
  collectSceneAssets,
  componentsOf,
  deserializeScene,
  fixedId,
  serializeScene,
  unknownComponentTypes,
} from '@three-studio/core';
import { particleEmitterType } from '@three-studio/particles/core';
import { NULL_ASSET_RESOLVER, activateRuntime, bindScene, createRuntimeRegistries } from '@three-studio/runtime';
import { Scene } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { sceneWith } from '../../../packages/core/test/fixtures';
import { createRenderingSettings } from '@three-studio/core';
import { kernelRegistries, registriesWithParticles } from './registries';

/*
 * What a build without this module does with a scene that holds an emitter.
 *
 * The module is one folder and a line in each root. Taking both away must cost
 * a project nothing: the scene still opens, the emitter is still in it, and the
 * next save writes it back as it was — so that putting the module back, or
 * opening the project where it is installed, finds what the author made.
 */

const SPRITE = fixedId('asset', 'spark');

/** A scene file written where the module is installed: a cube, and an emitter with a sprite. */
function written(): { text: string; emitterId: ReturnType<typeof createEntity>['entity']['id'] } {
  const registries = registriesWithParticles();
  const emitter = createEntity('Embers', [{ ...particleEmitterType.create(), spriteId: SPRITE, count: 750 }]);
  return {
    text: serializeScene(registries, sceneWith([createMeshEntity('box'), emitter])),
    emitterId: emitter.entity.id,
  };
}

describe('a scene holding an emitter, in a build without the module', () => {
  it('opens, with the emitter kept as a component of a type it does not define', () => {
    const { text, emitterId } = written();
    const kernel = kernelRegistries();

    const scene = deserializeScene(kernel, text);

    expect(scene.entities.has(emitterId)).toBe(true);
    expect(componentsOf(kernel, scene, emitterId)).toEqual([]);
    expect(unknownComponentTypes(scene)).toEqual(['particleEmitter']);
  });

  it('is saved back with the emitter as it was, field for field', () => {
    const { text } = written();
    const kernel = kernelRegistries();

    const saved = serializeScene(kernel, deserializeScene(kernel, text));

    // The file differs by nothing the author made: read where the module is
    // installed, both hold the same scene, and write the same bytes.
    const installed = registriesWithParticles();
    expect(JSON.parse(saved).components.particleEmitter).toEqual(JSON.parse(text).components.particleEmitter);
    expect(serializeScene(installed, deserializeScene(installed, saved))).toBe(text);
  });

  it('draws nothing for it, and does not throw', () => {
    const { text, emitterId } = written();
    const registries = createRuntimeRegistries();
    activateRuntime(registries);
    const doc = deserializeScene(registries, text);

    const binder = bindScene(new Scene(), doc, {
      registries,
      resolver: NULL_ASSET_RESOLVER,
      rendering: createRenderingSettings(),
    });

    // The entity is there, as an empty one: nothing was built on it.
    expect(binder.getObject(emitterId)?.children).toEqual([]);
    binder.dispose();
  });

  it('names no asset for it, which is why an export says the type is unknown', () => {
    const { text } = written();
    const kernel = kernelRegistries();
    const scene = deserializeScene(kernel, text);

    expect(collectSceneAssets(kernel, scene, new Map(), new Map(), new Set([SPRITE]))).not.toContain(SPRITE);
    const installed = registriesWithParticles();
    expect(collectSceneAssets(installed, deserializeScene(installed, text), new Map(), new Map(), new Set([SPRITE]))).toContain(
      SPRITE,
    );
  });
});
