import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  ASSETS_DIR,
  activateCore,
  assertDefined,
  colliderType,
  createColliderShape,
  createComponentForEntity,
  createEntity,
  createEmptyScene,
  createLightEntity,
  createMeshEntity,
  createPrefabDoc,
  createRenderingSettings,
  fixedId,
  rigidbodyType,
  scriptType,
  setComponentsOf,
  type AssetId,
  type EntityTemplate,
  type SceneDoc,
} from '@three-studio/core';
import {
  AssetCache,
  NULL_ASSET_RESOLVER,
  StudioTime,
  World,
  activateRuntime,
  createRuntimeRegistries,
  publishScriptApi,
  scriptClassesOf,
  scriptTypings,
} from '@three-studio/runtime';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { standInCanvas, standInForTheBrowser, takeTheBrowserBack } from '../../../packages/runtime/test/physics/rig';
import { buildScripts, writeScriptTsconfig, writeScriptTypings } from '../src/main/scripts';
import { builtInRegistries } from './registries';

/*
 * A version 5 script, end to end: written against the typings the editor
 * writes into a project, compiled by `tsc --strict` with no error, bundled as
 * Play bundles it, and run in a play world for two seconds. Every member of
 * the façade is used once — the handle, the transform, a component read,
 * written, added and removed, a spawn, a placement and a destroy, a message
 * and its reply, the body, the audio and the escape hatch — and what the
 * scripts logged is what the façade promised.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

const run = promisify(execFile);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const FACADE = `import { Behaviour, type Entity, type Message, type ScriptPropertyDef } from '@three-studio/runtime';

export default class Facade extends Behaviour {
  static properties: Record<string, ScriptPropertyDef> = {
    crate: { type: 'asset', kind: 'prefab' },
    door: { type: 'entity' },
  };

  crate = '';
  door = '';
  private frames = 0;
  private spark: Entity | null = null;
  private placed: Entity | null = null;
  private readonly where = { x: 0, y: 0, z: 0 };
  private readonly mouse = { x: 0, y: 0 };

  onStart(): void {
    this.log('start', this.entity.name, this.body.mass > 0, typeof this.audio.play, this.entity.object3D !== null);
  }

  onUpdate(): void {
    this.frames += 1;
    this.input.consumeMouseDelta(this.mouse);
    this.transform.getWorldPosition(this.where);
    if (this.frames === 1) this.log('rigidbody', this.entity.getComponent('rigidbody')?.bodyType);
    if (this.frames === 2) this.log('added', this.entity.addComponent('light')?.type);
    if (this.frames === 3) {
      const light = this.entity.getComponent('light');
      this.log('set', light !== null && this.entity.setComponent({ ...light, intensity: 3 }));
    }
    if (this.frames === 4) {
      const light = this.entity.getComponent('light');
      this.log('intensity', light?.intensity, light !== null && this.entity.removeComponent(light));
    }
    if (this.frames === 5) {
      this.log('light gone', this.entity.getComponent('light') === null);
      this.spark = this.world.spawn({ name: 'Spark', position: { x: 0, y: 2, z: 0 } });
      this.placed = this.world.instantiate(this.crate, { position: { x: 4, y: 5, z: 0 } });
      this.log('spawned', this.spark?.name, this.placed !== null);
      this.world.entity(this.door)?.send('open', { from: this.entity.id });
    }
    if (this.frames === 10) {
      this.spark?.destroy();
      this.log('spark', this.spark?.alive, this.world.entity(this.spark?.id ?? '') === null);
    }
    if (this.frames === 120) this.log('placed', this.placed?.alive, this.where.y < 1);
  }

  onMessage(message: Message): void {
    this.log('heard', message.name, this.frames);
  }
}
`;

const DOOR = `import { Behaviour, type Message } from '@three-studio/runtime';

export default class Door extends Behaviour {
  onMessage(message: Message): void {
    this.log('door heard', message.name);
    const payload = message.payload;
    if (typeof payload === 'object' && payload !== null && 'from' in payload && typeof payload.from === 'string') {
      this.world.entity(payload.from)?.send('opened');
    }
  }
}
`;

/** The editor window's runtime registries, as its root activates them. */
function runtimeRegistries() {
  const registries = createRuntimeRegistries();
  activateCore(registries);
  activateRuntime(registries);
  return registries;
}

function sceneOf(templates: readonly EntityTemplate[]): SceneDoc {
  const scene: SceneDoc = {
    ...createEmptyScene(),
    entities: new Map(templates.map(({ entity }) => [entity.id, entity])),
    rootOrder: templates.map(({ entity }) => entity.id),
  };
  for (const template of templates) setComponentsOf(scene, template.entity.id, template.components);
  return scene;
}

describe('a version 5 script', () => {
  it('compiles against its typings, bundles, and runs as the façade promises', { timeout: 60_000 }, async () => {
    const registries = runtimeRegistries();
    const project = await mkdtemp(join(tmpdir(), 'studio-facade-'));
    await mkdir(join(project, ASSETS_DIR, 'scripts'), { recursive: true });
    await writeFile(join(project, ASSETS_DIR, 'scripts', 'Facade.ts'), FACADE, 'utf8');
    await writeFile(join(project, ASSETS_DIR, 'scripts', 'Door.ts'), DOOR, 'utf8');
    await writeScriptTsconfig(project);
    await writeScriptTypings(project, scriptTypings(registries));

    // As an author's editor checks it: the project's own config, strict.
    const compiler = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
    const compiled = await run(process.execPath, [compiler, '--noEmit', '-p', join(project, 'tsconfig.json')]).catch(
      (cause: { stdout?: string; stderr?: string }) => cause,
    );
    expect(`${compiled.stdout ?? ''}${compiled.stderr ?? ''}`).toBe('');

    const { code, errors } = await buildScripts(builtInRegistries(), project);
    expect(errors).toEqual([]);
    publishScriptApi();
    const classes = scriptClassesOf(
      await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`),
    );
    const idOf = (name: string): AssetId =>
      assertDefined([...classes].find(([, type]) => type.name === name)?.[0], `the id of ${name}`);

    const CRATE = fixedId('asset', 'crate');
    const crate = createMeshEntity('box');
    crate.components.push(rigidbodyType.create(), createComponentForEntity(registries, 'collider', crate.components));
    const prefab = { ...createPrefabDoc('Crate', [crate.entity], crate.entity.id), id: CRATE };
    setComponentsOf(prefab, crate.entity.id, crate.components);

    const ground = createEntity('Ground', [
      { ...colliderType.create(), shape: { ...createColliderShape('box'), size: [40, 1, 40] } },
    ]);
    ground.entity.transform.position = [0, -0.5, 0];
    const door = createLightEntity('point');
    door.entity.name = 'Door';
    door.components.push({ ...scriptType.create(), assetId: idOf('Door') });
    const hero = createMeshEntity('box');
    hero.entity.name = 'Hero';
    hero.entity.transform.position = [0, 3, 0];
    hero.components.push(
      rigidbodyType.create(),
      createComponentForEntity(registries, 'collider', hero.components),
      { ...scriptType.create(), assetId: idOf('Facade'), props: { crate: CRATE, door: door.entity.id } },
    );

    const logged: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' ')));
    const world = await World.play({
      time: new StudioTime(),
      document: sceneOf([ground, door, hero]),
      registries,
      scripts: classes,
      prefabs: new Map([[CRATE, prefab]]),
      assets: new AssetCache(registries, { resolver: NULL_ASSET_RESOLVER, idleBudgetBytes: 0 }),
      rendering: { ...createRenderingSettings(), batching: false },
      element: standInCanvas().element,
    });
    try {
      for (let frame = 0; frame < 120; frame += 1) world.frame(1 / 60);
    } finally {
      world.dispose();
      vi.restoreAllMocks();
    }

    expect(logged).toEqual([
      '[Hero] start Hero true function true',
      '[Hero] rigidbody dynamic',
      '[Hero] added light',
      '[Hero] set true',
      '[Hero] intensity 3 true',
      '[Hero] light gone true',
      '[Hero] spawned Spark true',
      '[Door] door heard open',
      // Sent in frame 5, heard by the door at the start of 6, its reply at the
      // start of 7 — before the seventh `onUpdate` counts it.
      '[Hero] heard opened 6',
      '[Hero] spark false true',
      '[Hero] placed true true',
    ]);
    expect(world.warnings.filter((warning) => !/camera|lights/.test(warning))).toEqual([]);
  });
});
