import { describe, expect, it } from 'vitest';
import {
  componentAssets,
  componentDefinition,
  componentDefinitions,
  createComponent,
  createComponentForEntity,
  createEntity,
  createMeshComponent,
  createMeshEntity,
  deserializeScene,
  fillComponent,
  serializeScene,
  typesWithoutRuntime,
  type ComponentDoc,
  type ComponentType,
  type LightComponent,
  type MeshComponent,
  type SceneDoc,
} from '../src/index';
// Not part of the public surface: the point of the first test is to check the
// registry against the list the schema declares, which is a fact internal to core.
import { COMPONENT_TYPES, componentsOf, emptyComponentTables, setComponentsOf } from '../src/scene/components';

describe('component registry', () => {
  /*
   * The registry fills itself as a side effect of importing eleven modules. A
   * module nobody imports registers nothing and the type goes missing with no
   * error at all, so this is the assertion the whole design rests on.
   */
  it('knows every type the schema declares', () => {
    const registered = componentDefinitions().map((definition) => definition.type);
    expect([...registered].sort()).toEqual([...COMPONENT_TYPES].sort());
  });

  it('creates a component of the type asked for', () => {
    for (const type of COMPONENT_TYPES) {
      const component = createComponent(type);
      expect(component.type).toBe(type);
      expect(component.id).toMatch(/\S/);
    }
  });

  /*
   * The chain this replaced ended in `createPlayerController()`, so a component
   * from a plugin or a hand-edited file came back as a player controller with the
   * original's fields glued on — and the migration then wrote that to disk.
   */
  it('refuses a type it has never heard of', () => {
    expect(() => createComponent('teleporter' as ComponentType)).toThrow(/Unknown component type/);
    expect(componentDefinition('teleporter' as ComponentType)).toBeUndefined();
  });

  it('gives two components of a type distinct ids', () => {
    expect(createComponent('light').id).not.toBe(createComponent('light').id);
  });
});

describe('fill', () => {
  it('fills a component written before a field existed', () => {
    const stored = { id: 'c1', type: 'light' } as unknown as ComponentDoc;
    const filled = fillComponent(stored);
    expect(filled.id).toBe('c1');
    expect(filled).toMatchObject({ type: 'light', intensity: expect.any(Number) });
  });

  it('fills a light against its own kind, not against a fixed one', () => {
    /*
     * three's units differ by an order of magnitude between light kinds: a
     * directional light's default intensity is 2 and a point light's is 12.
     * Filling every light from the point defaults handed a stored directional
     * light six times the brightness its author chose — rule 2 of the
     * persisted-format rules read to the letter and missed in spirit, because
     * the factory that is the source of the defaults takes a kind.
     */
    const stored = { id: 'c1', type: 'light', kind: 'directional' } as unknown as ComponentDoc;
    const filled = fillComponent(stored) as LightComponent;

    expect(filled.kind).toBe('directional');
    expect(filled.intensity).toBe(2);
  });

  it('fills a light a level deeper, so its shadow settings are not undefined', () => {
    const stored = {
      id: 'c1',
      type: 'light',
      kind: 'spot',
      shadow: { bias: -0.0005 },
    } as unknown as ComponentDoc;

    const filled = fillComponent(stored) as LightComponent;
    expect(filled.shadow).toMatchObject({ bias: -0.0005, normalBias: 0, far: 500 });
  });

  /*
   * The one type whose fill is not a shallow spread. Texture slots and geometry
   * segments both reached three as `undefined` on scenes a fortnight old, twice,
   * before this merge went a level deeper — and a slider bound to `undefined`
   * took the whole Inspector down with it.
   */
  it('fills a mesh a level deeper than the top', () => {
    const stored = {
      id: 'c1',
      type: 'mesh',
      geometry: { kind: 'box', width: 4 },
      material: { color: '#ff0000' },
    } as unknown as ComponentDoc;

    const mesh = fillComponent(stored) as MeshComponent;
    expect(mesh.geometry).toMatchObject({ kind: 'box', width: 4, widthSegments: expect.any(Number) });
    expect(mesh.material).toMatchObject({ color: '#ff0000', roughness: expect.any(Number) });
    expect(mesh.materialId).toBeNull();
  });

  /*
   * Filling an unknown type against a type we do not have would invent a shape,
   * and the next save would write that invention over the author's data. A field
   * is deprecated, never lost.
   */
  it('leaves an unknown type exactly as found', () => {
    const stored = { id: 'c1', type: 'teleporter', target: 'x' } as unknown as ComponentDoc;
    expect(fillComponent(stored)).toBe(stored);
  });

  it('is what the scene migration goes through', () => {
    const entity = createEntity('Thing', [
      { id: 'c1', type: 'light' } as unknown as ComponentDoc,
      { id: 'c2', type: 'teleporter', target: 'x' } as unknown as ComponentDoc,
    ]);
    const scene: SceneDoc = {
      version: 1,
      id: 's1',
      name: 'Main',
      entities: { [entity.entity.id]: entity.entity },
      components: emptyComponentTables(),
      rootOrder: [entity.entity.id],
      environment: { background: '#000000' } as SceneDoc['environment'],
    };
    setComponentsOf(scene, entity.entity.id, entity.components);

    const loaded = deserializeScene(serializeScene(scene));
    const [light] = componentsOf(loaded, entity.entity.id);
    expect(light).toMatchObject({ type: 'light', intensity: expect.any(Number) });

    // Filed under a table of its own, since no type here claims it — and copied
    // through byte for byte, which is the rule that matters.
    const tables = loaded.components as unknown as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    expect(tables['teleporter']?.[entity.entity.id]?.['c2']).toEqual({
      id: 'c2',
      type: 'teleporter',
      target: 'x',
    });
  });
});

describe('assets', () => {
  it('names the material and every texture slot of a mesh', () => {
    const mesh = createMeshComponent('box');
    mesh.material.colorMap = 'tex-colour';
    mesh.material.normalMap = 'tex-normal';
    mesh.materialId = 'mat-1';

    const named = componentAssets(mesh);
    expect(named).toContain('mat-1');
    expect(named).toContain('tex-colour');
    expect(named).toContain('tex-normal');
  });

  it('names nothing for a type that points at no asset', () => {
    expect(componentAssets(createComponent('rigidbody'))).toEqual([]);
  });

  it('names nothing for an unknown type rather than guessing', () => {
    const stored = { id: 'c1', type: 'teleporter', assetId: 'a1' } as unknown as ComponentDoc;
    expect(componentAssets(stored)).toEqual([]);
  });
});

describe('createComponentForEntity', () => {
  it('shapes a collider from the mesh it joins', () => {
    const entity = createMeshEntity('sphere');
    const collider = createComponentForEntity('collider', entity.components);
    expect(collider).toMatchObject({ shape: 'sphere' });
  });

  it('is the plain factory for every other type', () => {
    const entity = createMeshEntity('box');
    expect(createComponentForEntity('light', entity.components).type).toBe('light');
  });
});

/*
 * The facet the registry adds, and the reason it was worth writing.
 *
 * `audioSource` and `audioListener` were in the schema, in the defaults, in the
 * inspector and in reference extraction — and nothing played a sound. The
 * components were editable and did nothing. Eight separate files cannot show
 * that; a value can, and this test is what makes the list impossible to grow
 * quietly: a type added with no system either arrives here or arrives claiming a
 * system it does not have, and `componentCoverage.test.ts` catches that.
 *
 * Audio was that gap, and the chantier closed it: both types now build a voice
 * through `registerBehaviour`. The list is empty, and the test stays — it is
 * what will name the next type someone adds to the schema and forgets to give a
 * runtime, which is the failure this whole registry exists to make visible.
 */
describe('types with no runtime', () => {
  it('is empty: every authorable component builds something', () => {
    expect([...typesWithoutRuntime()].sort()).toEqual([]);
  });
});
