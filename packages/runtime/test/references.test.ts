import {
  Registry,
  assertDefined,
  createLightEntity,
  createMeshComponent,
  createRenderingSettings,
  createWaterEntity,
  findComponent,
  fixedId,
  skySunDirection,
  type EntityTemplate,
  type SceneDoc,
  type SubsystemId,
  type Vec3,
} from '@three-studio/core';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { sceneWith } from '../../core/test/fixtures';
import { AssetCache } from '../src/assets/AssetCache';
import { NULL_ASSET_RESOLVER } from '../src/assets/AssetResolver';
import { MeshSystem } from '../src/components/mesh/MeshSystem';
import type { SceneBinder } from '../src/SceneBinder';
import { WaterSurface } from '../src/systems/WaterSurface';
import { StudioTime } from '../src/time/StudioTime';
import { World, type EditWorldOptions, type SubsystemDefinition } from '../src/world/World';
import { builtInRegistries } from './registries';

/*
 * A component naming an entity — a water lit by a light — is read again when
 * that entity changes: the water reads its sun when it is built or patched,
 * and a light that turns, changes colour, goes or comes back is a change of
 * the light's, not the water's. Before, a water whose id sorted before its
 * light's in a scene's file was built first, took the sky's sun, and kept it.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

const LAMP = fixedId('entity', 'lamp');
const POND = fixedId('entity', 'pond');
const STEP = 1 / 60;

/** A directional light turned to shine along +x, orange; and a water lit by it, carrying a mesh too, listed first. */
function lampAndPond(): { lamp: EntityTemplate; pond: EntityTemplate; document: SceneDoc } {
  const lamp = createLightEntity('directional');
  lamp.entity.id = LAMP;
  lamp.entity.transform.rotation = [0, Math.PI / 2, 0];
  const pond = createWaterEntity();
  pond.entity.id = POND;
  pond.components.push(createMeshComponent('box'));
  for (const component of [...lamp.components, ...pond.components]) {
    if (component.type === 'light') component.color = '#ff8800';
    if (component.type === 'water') component.sun = { kind: 'light', entity: LAMP };
  }
  return { lamp, pond, document: sceneWith([pond, lamp]) };
}

/** The lamp as an edit leaves it: new objects, turned to `rotation`, of `color`. */
function edited(lamp: EntityTemplate, rotation: Vec3, color: string): EntityTemplate {
  return {
    entity: { ...lamp.entity, transform: { ...lamp.entity.transform, rotation } },
    components: lamp.components.map((component) => (component.type === 'light' ? { ...component, color } : component)),
  };
}

function options(document: SceneDoc, definitions: readonly SubsystemDefinition[] = []): EditWorldOptions {
  const registries = builtInRegistries();
  const subsystems = new Registry<SubsystemId, SubsystemDefinition>('subsystem');
  for (const definition of definitions) subsystems.register(definition);
  return {
    time: new StudioTime(),
    document,
    registries: { ...registries, subsystems },
    assets: new AssetCache(registries, { resolver: NULL_ASSET_RESOLVER, idleBudgetBytes: 0 }),
    rendering: { ...createRenderingSettings(), batching: false },
  };
}

/** Where the pond's surface takes its light from, rounded, and the colour of it. */
function litBy(binder: SceneBinder): { direction: number[]; color: string } {
  const surface = binder.getObject(POND)?.children.find((child) => child instanceof WaterSurface);
  if (!(surface instanceof WaterSurface)) throw new Error('The pond drew no surface.');
  return {
    direction: surface.sunDirection.value.toArray().map((value) => Math.round(value * 1e6) / 1e6 + 0),
    color: surface.sunColor.value.getHexString(),
  };
}

/** The sky's sun of a document, rounded as `litBy` rounds. */
function skyOf(document: SceneDoc): number[] {
  return skySunDirection(document.environment.sky).map((value) => Math.round(value * 1e6) / 1e6 + 0);
}

describe('a water lit by a light, in the edit view', () => {
  it('is lit by its light when built, though it comes first in the document', () => {
    const { document } = lampAndPond();
    const world = World.edit(options(document));
    onTestFinished(() => world.dispose());

    expect(litBy(world.binder)).toEqual({ direction: [1, 0, 0], color: 'ff8800' });
  });

  it('follows its light as it turns, changes colour, goes and comes back, the light alone synced', () => {
    const { lamp, pond, document } = lampAndPond();
    const world = World.edit(options(document));
    onTestFinished(() => world.dispose());
    const meshPatches = vi.spyOn(MeshSystem.prototype, 'patch');
    const changed = new Set([LAMP]);

    world.binder.sync(sceneWith([pond, edited(lamp, [0, -Math.PI / 2, 0], '#00ff00')]), changed);
    expect(litBy(world.binder)).toEqual({ direction: [-1, 0, 0], color: '00ff00' });

    world.binder.sync(sceneWith([pond]), changed);
    expect(litBy(world.binder).direction).toEqual(skyOf(document));

    world.binder.sync(sceneWith([pond, lamp]), changed);
    expect(litBy(world.binder)).toEqual({ direction: [1, 0, 0], color: 'ff8800' });
    // The pond's mesh names no entity, and was read again by none of it.
    expect(meshPatches).not.toHaveBeenCalled();
  });
});

describe('a water lit by a light, in a running world', () => {
  it('follows its light through the frame’s pass, its subsystems handed it again, and nothing else', async () => {
    const { document } = lampAndPond();
    const handed: string[] = [];
    const counting: SubsystemDefinition = {
      id: fixedId('subsystem', 'counting'),
      mounts: ['water', 'mesh'],
      create: () => ({
        patch: (entityId, previous, next) =>
          void handed.push(`${entityId}:${next.type}${previous === next ? ' as it is' : ''}`),
        dispose() {},
      }),
    };
    const world = await World.play(options(document, [counting]));
    onTestFinished(() => world.dispose());
    const light = assertDefined(findComponent(world.document, LAMP, 'light'), "the lamp's light");

    world.putComponent(LAMP, { ...light, color: '#00ff00' });
    world.frame(STEP);
    expect(litBy(world.binder)).toEqual({ direction: [1, 0, 0], color: '00ff00' });

    world.deleteComponent(LAMP, light.id);
    world.frame(STEP);
    expect(litBy(world.binder).direction).toEqual(skyOf(document));

    world.putComponent(LAMP, light);
    world.frame(STEP);
    expect(litBy(world.binder)).toEqual({ direction: [1, 0, 0], color: 'ff8800' });

    expect(handed).toEqual(['pond:water as it is', 'pond:water as it is', 'pond:water as it is']);
  });
});
