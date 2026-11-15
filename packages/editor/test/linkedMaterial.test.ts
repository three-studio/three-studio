import {
  assertDefined,
  colliderType,
  createCoreRegistries,
  createEntity,
  createMaterial,
  createMeshComponent,
  createPhysicsMaterial,
  findComponent,
  fixedId,
  meshType,
  rigidbodyType,
  type AssetId,
  type ColliderComponent,
  type ComponentDefinition,
  type CoreRegistries,
  type EntityId,
  type MaterialDef,
  type MeshComponent,
  type PhysicsMaterialDef,
} from '@three-studio/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sceneWith } from '../../core/test/fixtures';
import { paneEntriesFor } from '../src/inspector/panes';
import { editLinkedAsset, effectiveComponent, linkedAsset } from '../src/inspector/buildInspector';
import { isAction, type ActionSpec } from '../src/inspector/schema';
import { useAssetStore } from '../src/state/assetStore';
import { useDialogStore } from '../src/state/dialogStore';
import { useDocumentStore } from '../src/state/documentStore';
import { builtInRegistries } from './registries';

const registries = builtInRegistries();

/*
 * An object an asset fills is edited where it is linked: the Inspector shows
 * the asset's values, and an edit goes to its file, as one undo step, for every
 * entity that links it — never into the document. Which objects are linked is
 * what each type's schema declares (`linkedBy`), and nothing else.
 */

const doc = () => useDocumentStore.getState();
const ice = { ...createPhysicsMaterial(), friction: 0.05 };
const stone = createMaterial('#777777');
const ICE = fixedId('asset', 'ice');
const STONE = fixedId('asset', 'stone');
const GONE = fixedId('asset', 'gone');
const NEW_PHYSICS_MATERIAL = fixedId('asset', 'new-physics-material');

const real = (({ saveMaterial, savePhysicsMaterial, createPhysicsMaterial }) => ({
  saveMaterial,
  savePhysicsMaterial,
  createPhysicsMaterial,
}))(useAssetStore.getState());

/** The store's writes, recorded rather than sent to a main process. */
const saves = {
  saveMaterial: vi.fn(async (_assetId: AssetId, _material: MaterialDef) => {}),
  savePhysicsMaterial: vi.fn(async (_assetId: AssetId, _material: PhysicsMaterialDef) => {}),
  createPhysicsMaterial: vi.fn(async () => NEW_PHYSICS_MATERIAL),
};

beforeEach(() => {
  for (const save of Object.values(saves)) save.mockClear();
  useAssetStore.setState({
    materials: new Map([[STONE, stone]]),
    physicsMaterials: new Map([[ICE, ice]]),
    ...saves,
  });
  useDialogStore.getState().cancel();
});

afterEach(() => {
  useAssetStore.setState(real);
});

/** Registries holding this one definition, for a type declared otherwise than the built-in. */
function registriesOf(definition: ComponentDefinition): CoreRegistries {
  const made = createCoreRegistries();
  made.components.register(definition);
  return made;
}

/** A Cube whose Collider grips by its own 0.7, linking `materialId`. */
function cubeLinking(materialId: AssetId | null): EntityId {
  const cube = createEntity('Cube', [{ ...colliderType.create(), materialId }]);
  doc().replaceScene(sceneWith([cube]));
  return cube.entity.id;
}

/** A Cube whose Mesh links `materialId`. */
function meshLinking(materialId: AssetId | null): EntityId {
  const cube = createEntity('Cube', [{ ...createMeshComponent('box'), materialId }]);
  doc().replaceScene(sceneWith([cube]));
  return cube.entity.id;
}

const colliderOf = (entityId: EntityId): ColliderComponent =>
  assertDefined(findComponent(doc().scene, entityId, 'collider'), 'its collider');
const meshOf = (entityId: EntityId): MeshComponent =>
  assertDefined(findComponent(doc().scene, entityId, 'mesh'), 'its mesh');

describe('a linked physics material', () => {
  it('a collider linked to a physics material shows its values, and an edit goes to the asset in one undo step', () => {
    const cube = cubeLinking(ICE);

    const effective = effectiveComponent(registries, cube, colliderOf(cube));
    expect(effective.type === 'collider' && effective.material).toEqual(ice);
    const linked = assertDefined(linkedAsset(registries, colliderOf(cube), ['material', 'friction']), 'the link');
    expect(linked).toMatchObject({ kind: 'physicsMaterial', assetId: ICE, path: ['friction'], noun: 'physics material' });

    editLinkedAsset(linked, 'Friction', 0.1);
    expect(saves.savePhysicsMaterial).toHaveBeenLastCalledWith(ICE, { ...ice, friction: 0.1 });
    expect(colliderOf(cube).material.friction).toBe(0.7);
    expect(doc().undoLabel()).toBe('Edit physics material Friction');

    doc().undo();
    expect(saves.savePhysicsMaterial).toHaveBeenLastCalledWith(ICE, ice);
    doc().redo();
    expect(saves.savePhysicsMaterial).toHaveBeenLastCalledWith(ICE, { ...ice, friction: 0.1 });
  });

  it('a link the project cannot answer edits the collider’s own values', () => {
    const cube = cubeLinking(GONE);

    expect(linkedAsset(registries, colliderOf(cube), ['material', 'friction'])).toBeNull();
    const effective = effectiveComponent(registries, cube, colliderOf(cube));
    expect(effective.type === 'collider' && effective.material.friction).toBe(0.7);
  });

  it('the asset slot beside the object is the component’s own row, linked or not', () => {
    expect(linkedAsset(registries, colliderOf(cubeLinking(ICE)), ['materialId'])).toBeNull();
  });
});

describe('a linked material', () => {
  it('a mesh’s linked material shows its values, and keeps its edit going to its asset', () => {
    const cube = meshLinking(STONE);

    const effective = effectiveComponent(registries, cube, meshOf(cube));
    expect(effective.type === 'mesh' && effective.material).toEqual(stone);

    editLinkedAsset(assertDefined(linkedAsset(registries, meshOf(cube), ['material', 'roughness']), 'the link'), 'Roughness', 0.2);
    expect(saves.saveMaterial).toHaveBeenLastCalledWith(STONE, { ...stone, roughness: 0.2 });
    expect(doc().undoLabel()).toBe('Edit material Roughness');
    doc().undo();
    expect(saves.saveMaterial).toHaveBeenLastCalledWith(STONE, stone);
  });

  it('a mesh whose material the project lacks shows and edits its own', () => {
    const cube = meshLinking(GONE);

    expect(linkedAsset(registries, meshOf(cube), ['material', 'roughness'])).toBeNull();
    const effective = effectiveComponent(registries, cube, meshOf(cube));
    expect(effective.type === 'mesh' && effective.material).toEqual(meshOf(cube).material);
  });
});

describe('an object a type links', () => {
  it('is what the type declares: its label names the edit', () => {
    // The mesh, its link labelled otherwise: the Inspector reads the type's
    // declaration, and holds no name of its own for it.
    const finish = { ...meshType, links: meshType.links.map((link) => ({ ...link, label: 'Finish' })) };
    const using = registriesOf(finish satisfies ComponentDefinition);
    const cube = meshLinking(STONE);

    const effective = effectiveComponent(using, cube, meshOf(cube));
    expect(effective.type === 'mesh' && effective.material).toEqual(stone);
    editLinkedAsset(assertDefined(linkedAsset(using, meshOf(cube), ['material', 'roughness']), 'the link'), 'Roughness', 0.2);
    expect(saves.saveMaterial).toHaveBeenLastCalledWith(STONE, { ...stone, roughness: 0.2 });
    expect(doc().undoLabel()).toBe('Edit finish Roughness');
  });

  it('is not linked where the type declares no link, whatever its fields hold', () => {
    const using = registriesOf({ ...colliderType, links: [] } satisfies ComponentDefinition);
    const cube = cubeLinking(ICE);

    expect(linkedAsset(using, colliderOf(cube), ['material', 'friction'])).toBeNull();
    const effective = effectiveComponent(using, cube, colliderOf(cube));
    expect(effective.type === 'collider' && effective.material.friction).toBe(0.7);
  });

  it('a type that links nothing gets its tuned component back itself', () => {
    const body = rigidbodyType.create();
    const entity = createEntity('Body', [body]);
    doc().replaceScene(sceneWith([entity]));

    expect(effectiveComponent(registries, entity.entity.id, body)).toBe(body);
  });
});

describe('the collider’s two actions', () => {
  const run = (entityId: EntityId, title: string): void => {
    const component = colliderOf(entityId);
    const action = paneEntriesFor(registries, component).entries.find(
      (entry): entry is ActionSpec => isAction(entry) && entry.title === title,
    );
    if (!action) throw new Error(`no ${title} action`);
    action.run({ registries, entityId, componentId: component.id, component });
  };

  it('Save as Asset… links a collider to a new physics material of its own values; Make Unique copies them back and unlinks', async () => {
    const cube = cubeLinking(null);
    const own = colliderOf(cube).material;

    run(cube, 'Save as Asset…');
    await vi.waitFor(() => expect(useDialogStore.getState().prompt).not.toBeNull());
    expect(useDialogStore.getState().prompt?.defaultValue).toBe('Cube Physics Material');
    useDialogStore.getState().submit('Ice');
    await vi.waitFor(() => expect(colliderOf(cube).materialId).toBe(NEW_PHYSICS_MATERIAL));
    expect(saves.createPhysicsMaterial).toHaveBeenCalledWith(registries, 'Ice', own);

    // The table as a refresh leaves it, the asset holding Ice's values.
    useAssetStore.setState({
      physicsMaterials: new Map([
        [ICE, ice],
        [NEW_PHYSICS_MATERIAL, ice],
      ]),
    });
    run(cube, 'Make Unique');

    expect(colliderOf(cube).material).toEqual(ice);
    expect(colliderOf(cube).materialId).toBeNull();
  });
});
