import {
  createComponent,
  createEntity,
  createMaterial,
  createMeshEntity,
  createPhysicsMaterial,
  findComponent,
  type ColliderComponent,
  type MeshComponent,
} from '@three-studio/core';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { sceneWith } from '../../core/test/fixtures';
import { COMPONENT_PANES } from '../src/components/panes';
import { effectiveComponent, linkedMaterial } from '../src/inspector/buildInspector';
import { isAction, type ActionSpec } from '../src/inspector/schema';
import { useAssetStore } from '../src/state/assetStore';
import { useDialogStore } from '../src/state/dialogStore';
import { useDocumentStore } from '../src/state/documentStore';

/*
 * A shared asset is edited where it is linked: the Inspector shows the asset's
 * values, and an edit goes to its file, as one undo step, for every entity that
 * links it — never into the document.
 */

const doc = () => useDocumentStore.getState();
const ice = { ...createPhysicsMaterial(), friction: 0.05 };
const stone = createMaterial('#777777');

const real = (({ saveMaterial, savePhysicsMaterial, createPhysicsMaterial }) => ({
  saveMaterial,
  savePhysicsMaterial,
  createPhysicsMaterial,
}))(useAssetStore.getState());

/** The store's writes, recorded rather than sent to a main process. */
let saves: {
  saveMaterial: Mock<() => Promise<void>>;
  savePhysicsMaterial: Mock<() => Promise<void>>;
  createPhysicsMaterial: Mock<() => Promise<string>>;
};

beforeEach(() => {
  saves = {
    saveMaterial: vi.fn(async () => {}),
    savePhysicsMaterial: vi.fn(async () => {}),
    createPhysicsMaterial: vi.fn(async () => 'new-physics-material'),
  };
  useAssetStore.setState({ materials: { stone }, physicsMaterials: { ice }, ...saves });
  useDialogStore.getState().cancel();
});

afterEach(() => {
  useAssetStore.setState(real);
});

/** A Cube whose Collider grips by its own 0.7, linking `materialId`. */
function cubeLinking(materialId: string | null): string {
  const cube = createEntity('Cube', [{ ...createComponent('collider'), materialId }]);
  doc().replaceScene(sceneWith([cube]));
  return cube.entity.id;
}

const colliderOf = (entityId: string): ColliderComponent =>
  findComponent(doc().scene, entityId, 'collider')!;

describe('a linked physics material', () => {
  it('a collider linked to a physics material shows its values, and an edit goes to the asset in one undo step', () => {
    const cube = cubeLinking('ice');

    expect((effectiveComponent(cube, colliderOf(cube)) as ColliderComponent).material).toEqual(ice);
    const linked = linkedMaterial(colliderOf(cube), ['material', 'friction']);
    expect(linked?.assetId).toBe('ice');

    linked!.edit('Friction', 'friction', 0.1);
    expect(saves.savePhysicsMaterial).toHaveBeenLastCalledWith('ice', { ...ice, friction: 0.1 });
    expect(colliderOf(cube).material.friction).toBe(0.7);
    expect(doc().undoLabel()).toBe('Edit physics material Friction');

    doc().undo();
    expect(saves.savePhysicsMaterial).toHaveBeenLastCalledWith('ice', ice);
    doc().redo();
    expect(saves.savePhysicsMaterial).toHaveBeenLastCalledWith('ice', { ...ice, friction: 0.1 });
  });

  it('a link the project cannot answer edits the collider’s own values', () => {
    const cube = cubeLinking('gone');

    expect(linkedMaterial(colliderOf(cube), ['material', 'friction'])).toBeNull();
    expect((effectiveComponent(cube, colliderOf(cube)) as ColliderComponent).material.friction).toBe(0.7);
  });

  it('a mesh’s linked material keeps its edit going to its asset', () => {
    const mesh = createMeshEntity('box');
    (mesh.components[0] as MeshComponent).materialId = 'stone';
    doc().replaceScene(sceneWith([mesh]));
    const component = () => findComponent(doc().scene, mesh.entity.id, 'mesh')!;

    expect((effectiveComponent(mesh.entity.id, component()) as MeshComponent).material).toEqual(stone);
    const linked = linkedMaterial(component(), ['material', 'roughness']);
    expect(linked?.assetId).toBe('stone');

    linked!.edit('Roughness', 'roughness', 0.2);
    expect(saves.saveMaterial).toHaveBeenLastCalledWith('stone', { ...stone, roughness: 0.2 });
    expect(doc().undoLabel()).toBe('Edit material Roughness');
    doc().undo();
    expect(saves.saveMaterial).toHaveBeenLastCalledWith('stone', stone);
  });
});

describe('the collider’s two actions', () => {
  const run = (entityId: string, title: string): void => {
    const action = COMPONENT_PANES.collider.fields.find(
      (entry): entry is ActionSpec => isAction(entry) && entry.title === title,
    );
    if (!action) throw new Error(`no ${title} action`);
    const component = colliderOf(entityId);
    action.run({ entityId, componentId: component.id, component });
  };

  it('Save as Asset… links a collider to a new physics material of its own values; Make Unique copies them back and unlinks', async () => {
    const cube = cubeLinking(null);
    const own = colliderOf(cube).material;

    run(cube, 'Save as Asset…');
    await vi.waitFor(() => expect(useDialogStore.getState().prompt).not.toBeNull());
    expect(useDialogStore.getState().prompt?.defaultValue).toBe('Cube Physics Material');
    useDialogStore.getState().submit('Ice');
    await vi.waitFor(() => expect(colliderOf(cube).materialId).toBe('new-physics-material'));
    expect(saves.createPhysicsMaterial).toHaveBeenCalledWith('Ice', own);

    // The table as a refresh leaves it, the asset holding Ice's values.
    useAssetStore.setState({ physicsMaterials: { ice, 'new-physics-material': ice } });
    run(cube, 'Make Unique');

    expect(colliderOf(cube).material).toEqual(ice);
    expect(colliderOf(cube).materialId).toBeNull();
  });
});
