import {
  componentsOf,
  createComponent,
  createEmptyScene,
  createEntity,
  createMeshEntity,
  putComponent,
  type MeshComponent,
} from '@three-studio/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { addEntity } from '../src/commands/sceneCommands';
import { useDocumentStore } from '../src/state/documentStore';
import { useEditorStore } from '../src/state/editorStore';
import { MultiTarget } from '../src/inspector/target';

/*
 * Several entities presented as one — Godot's `MultiNodeEdit`, Unity's
 * `serializedObject` with multiple targets.
 *
 * `buildInspector` does not know this class exists: it only ever saw
 * `EntityTarget`, which is why phase 4 built that interface before there was
 * anything to put behind it.
 */

const doc = () => useDocumentStore.getState();

beforeEach(() => {
  useDocumentStore.getState().replaceScene(createEmptyScene());
  useEditorStore.getState().clearSelection();
});

/** Two cubes whose mesh components agree on everything. */
function twoCubes() {
  const a = createMeshEntity('box');
  const b = createMeshEntity('box');
  addEntity(a);
  addEntity(b);
  return [a, b] as const;
}

describe('reading across several entities', () => {
  it('reports a value they agree on as settled', () => {
    const [a, b] = twoCubes();
    const target = new MultiTarget([a.entity.id, b.entity.id]);
    const mesh = target.components()[0];

    expect(mesh?.read(['castShadow'])).toEqual({ value: true, mixed: false });
  });

  it('reports a value they disagree on as mixed', () => {
    const [a, b] = twoCubes();
    doc().mutate('Differ', (draft) => {
      (componentsOf(draft, b.entity.id)[0] as MeshComponent).castShadow = false;
    });

    const mesh = new MultiTarget([a.entity.id, b.entity.id]).components()[0];
    const reading = mesh?.read(['castShadow']);
    // The dash Unity and Unreal both show. The value is the first one's, so the
    // control has something to display.
    expect(reading?.mixed).toBe(true);
    expect(reading?.value).toBe(true);
  });

  it('compares nested values by content, not by reference', () => {
    const [a, b] = twoCubes();
    const mesh = new MultiTarget([a.entity.id, b.entity.id]).components()[0];

    // Two equal colours are two objects; comparing references would report every
    // object-valued field as mixed.
    expect(mesh?.read(['material', 'color']).mixed).toBe(false);
  });
});

describe('pairing components across entities', () => {
  it('keeps only the types they all have', () => {
    const [a, b] = twoCubes();
    doc().mutate('One rigidbody', (draft) => {
      putComponent(draft, a.entity.id, createComponent('rigidbody'));
    });

    // Showing a field only some objects have would write it onto the others,
    // which is not what the author asked for.
    const types = new MultiTarget([a.entity.id, b.entity.id]).components().map((c) => c.type);
    expect(types).toEqual(['mesh']);
  });

  it('pairs by rank when an entity has two of a type', () => {
    const a = createEntity('A', [createComponent('collider'), createComponent('collider')]);
    const b = createEntity('B', [createComponent('collider'), createComponent('collider')]);
    addEntity(a);
    addEntity(b);

    // Ids differ between entities, so the pairing is by type and rank — the very
    // reason `EntityTarget` hands back component objects rather than paths.
    expect(new MultiTarget([a.entity.id, b.entity.id]).components()).toHaveLength(2);
  });

  it("shows nothing for a selection of one, which is SingleTarget's job", () => {
    const [a] = twoCubes();
    expect(new MultiTarget([a.entity.id]).components()).toEqual([]);
  });
});

describe('writing to several entities', () => {
  it('lands as one undo step', () => {
    const [a, b] = twoCubes();
    const mesh = new MultiTarget([a.entity.id, b.entity.id]).components()[0]!;
    const before = doc().past.length;

    mesh.write(['castShadow'], false, { coalesceKey: 'multi' });

    const meshOf = (id: string) => componentsOf(doc().scene, id)[0] as MeshComponent;
    expect(meshOf(a.entity.id).castShadow).toBe(false);
    expect(meshOf(b.entity.id).castShadow).toBe(false);
    // One entry for however many objects — the coalesce key is what merges them.
    expect(doc().past.length).toBe(before + 1);

    doc().undo();
    expect(meshOf(a.entity.id).castShadow).toBe(true);
    expect(meshOf(b.entity.id).castShadow).toBe(true);
  });

  it('refuses a capability as soon as one member cannot', () => {
    const [a, b] = twoCubes();
    doc().mutate('Lock one', (draft) => {
      draft.entities[b.entity.id]!.locked = true;
    });

    const target = new MultiTarget([a.entity.id, b.entity.id]);
    expect(target.can('rename')).toBe(true);
    expect(target.can('translate')).toBe(false);
  });
});
