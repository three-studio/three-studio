import { createCameraEntity, createLightEntity, createMeshEntity } from '@three-studio/core';
import { SceneBinder } from '@three-studio/runtime/SceneBinder';
import { Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { sceneWith } from '../../core/test/fixtures';
import { SelectionOutline } from '../src/viewport/SelectionOutline';

/*
 * What is drawn around a selection, and what is only measured.
 *
 * A light and a camera have no renderable extent, so `Box3.setFromObject` hands
 * back an empty box. The outline used to answer that by inventing a 0.35-unit
 * cube — which read as a box *around* a light rather than as the light, and now
 * sits on top of the marker that already says the same thing.
 *
 * The half that has to survive is the measurement: `bounds()` is what the orbit
 * pivot and the F shortcut aim at, and framing a light is exactly when an author
 * reaches for F. Both halves are pinned here, because removing the first is what
 * breaks the second.
 */

function outlineFor(templates: Parameters<typeof sceneWith>[0]): {
  outline: SelectionOutline;
  binder: SceneBinder;
} {
  const binder = new SceneBinder();
  const scene = sceneWith(templates);
  binder.sync(scene);
  return { outline: new SelectionOutline(), binder };
}

describe('what gets a box', () => {
  it('draws one around something with geometry', () => {
    const box = createMeshEntity('box');
    const { outline, binder } = outlineFor([box]);

    outline.update([box.entity.id], (id) => binder.getObject(id));

    expect(outline.root.children).toHaveLength(1);
  });

  it('draws none around a light or a camera', () => {
    const light = createLightEntity('point');
    const camera = createCameraEntity();
    const { outline, binder } = outlineFor([light, camera]);

    outline.update([light.entity.id, camera.entity.id], (id) => binder.getObject(id));

    expect(outline.root.children).toHaveLength(0);
  });

  it('still measures what it does not draw', () => {
    // The whole point of keeping the synthesised box. `null` here would leave
    // `F` and the orbit pivot with nothing to aim at.
    const light = createLightEntity('point');
    light.entity.transform.position = [4, 1, -2];
    const { outline, binder } = outlineFor([light]);

    outline.update([light.entity.id], (id) => binder.getObject(id));
    const bounds = outline.bounds();

    expect(bounds).not.toBeNull();
    expect(bounds?.containsPoint(new Vector3(4, 1, -2))).toBe(true);
  });

  it('covers both kinds at once in a mixed selection', () => {
    const box = createMeshEntity('box');
    box.entity.transform.position = [10, 0, 0];
    const light = createLightEntity('point');
    const { outline, binder } = outlineFor([box, light]);

    outline.update([box.entity.id, light.entity.id], (id) => binder.getObject(id));

    // One box drawn, for the mesh; the bound spans both.
    expect(outline.root.children).toHaveLength(1);
    expect(outline.bounds()?.max.x).toBeGreaterThanOrEqual(10);
  });

  it('takes the box away when the entity loses its extent', () => {
    /*
     * Reachable in one edit: a model's mesh is gone before its replacement has
     * loaded. Left standing, the box would hang in the air around an entity that
     * is no longer drawing anything.
     */
    const box = createMeshEntity('box');
    const { outline, binder } = outlineFor([box]);
    const resolve = (id: string) => binder.getObject(id);

    outline.update([box.entity.id], resolve);
    expect(outline.root.children).toHaveLength(1);

    // The container is still there and still selected; what it held is not.
    binder.getObject(box.entity.id)?.clear();
    outline.update([box.entity.id], resolve);

    expect(outline.root.children).toHaveLength(0);
    expect(outline.bounds()).not.toBeNull();
  });
});
