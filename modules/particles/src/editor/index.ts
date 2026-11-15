import { combineDisposables, createEntity, type Disposable } from '@three-studio/core';
import type { AddMenuGroup, EditorRegistries, EntityOverlay, HierarchyIcon } from '@three-studio/editor';
import { particleEmitterType } from '@three-studio/particles/core';
import { Sparkles } from 'lucide-react';

/*
 * Particles, the editor part: what the Add menu offers, what the viewport draws
 * about an emitter, and its row's icon. No pane: the type is written as a
 * schema, and the Inspector derives its pane from that.
 */

/**
 * A submenu for one entry, for the reason Water's is one: this is where the
 * things that are an *effect* rather than an object will go — trails and decals
 * are the obvious next two — and moving Particles in later would move it out
 * from under whatever muscle memory it had built by then.
 */
const menu: AddMenuGroup = {
  id: 'particleEmitter',
  label: 'Effects',
  order: 6,
  entries: [{ label: 'Particles', create: () => createEntity('Particles', [particleEmitterType.create()]) }],
};

const overlay: EntityOverlay = {
  id: 'particleEmitter',
  /*
   * No geometry of its own, for all that it draws. The particles are there and
   * they are not the emitter: they are somewhere else by design, they are
   * transparent, and there are none at all at the instant a scene is opened
   * before the clock has moved. What an author drags is the emitter, and
   * without a marker there is nothing at that place to click.
   */
  drawsGeometry: false,
  /*
   * After the camera, the light and the two audio components: an emitter is
   * scenery, and when one shares an entity with a light it is the light that
   * says what the entity is.
   */
  marker: { color: 0xffb86b, pixels: 9, priority: 5 },
  /*
   * No annotation. The shape worth drawing is the emission volume, and it is
   * worth drawing — but the marker already says where the emitter is, and the
   * plume itself says which way it throws. Left out until someone is editing a
   * radius and wants it.
   */
  helper: null,
};

/**
 * After the kernel's, beside water and for the same reason: an emitter draws
 * nothing an author can click, so the row is the only place the tree can say
 * what it is.
 */
const icon: HierarchyIcon = { id: 'particleEmitter', icon: Sparkles, priority: 7 };

/** Registers what the editor shows of a particle emitter. Disposing takes it out again. */
export function activate(registries: EditorRegistries): Disposable {
  return combineDisposables([
    registries.addMenu.register(menu),
    registries.overlays.register(overlay),
    registries.icons.register(icon),
  ]);
}
