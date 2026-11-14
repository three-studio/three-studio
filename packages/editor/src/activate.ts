import { combineDisposables, type Disposable } from '@three-studio/core';
import { pane as audioListenerPane } from './components/audioListener/inspector';
import { menu as audioListenerMenu } from './components/audioListener/menu';
import { overlay as audioListenerOverlay } from './components/audioListener/overlay';
import { pane as audioSourcePane } from './components/audioSource/inspector';
import { menu as audioSourceMenu } from './components/audioSource/menu';
import { overlay as audioSourceOverlay } from './components/audioSource/overlay';
import { pane as cameraPane } from './components/camera/inspector';
import { menu as cameraMenu } from './components/camera/menu';
import { overlay as cameraOverlay } from './components/camera/overlay';
import { pane as colliderPane } from './components/collider/inspector';
import { overlay as colliderOverlay } from './components/collider/overlay';
import { pane as jointPane } from './components/joint/inspector';
import { overlay as jointOverlay } from './components/joint/overlay';
import { pane as lightPane } from './components/light/inspector';
import { menu as lightMenu } from './components/light/menu';
import { overlay as lightOverlay } from './components/light/overlay';
import { pane as meshPane } from './components/mesh/inspector';
import { menu as meshMenu } from './components/mesh/menu';
import { overlay as meshOverlay } from './components/mesh/overlay';
import { pane as modelPane } from './components/model/inspector';
import { overlay as modelOverlay } from './components/model/overlay';
import { menu as particleEmitterMenu } from './components/particleEmitter/menu';
import { overlay as particleEmitterOverlay } from './components/particleEmitter/overlay';
import { pane as playerControllerPane } from './components/playerController/inspector';
import { overlay as playerControllerOverlay } from './components/playerController/overlay';
import { pane as prefabInstancePane } from './components/prefabInstance/inspector';
import { overlay as prefabInstanceOverlay } from './components/prefabInstance/overlay';
import { pane as rigidbodyPane } from './components/rigidbody/inspector';
import { overlay as rigidbodyOverlay } from './components/rigidbody/overlay';
import { pane as scriptPane } from './components/script/inspector';
import { overlay as scriptOverlay } from './components/script/overlay';
import { pane as waterPane } from './components/water/inspector';
import { menu as waterMenu } from './components/water/menu';
import { overlay as waterOverlay } from './components/water/overlay';
import { HIERARCHY_ICONS } from './components/icons';
import type { AddMenuGroup, EntityOverlay } from './components/registry';
import type { ComponentPane } from './inspector/fields';
import type { EditorRegistries } from './registries';

/*
 * The kernel's editor parts, listed, and the one function that registers them.
 *
 * Each list is in the order core registers the types, which is the order an
 * entity's components are read in. Only the Add menu's shows: two types that
 * name one submenu are listed in it in this order, the audio source above the
 * listener.
 */

/** The panes still written by hand: every kernel type but the ones written as a schema. */
const PANES: readonly ComponentPane[] = [
  meshPane,
  modelPane,
  lightPane,
  cameraPane,
  rigidbodyPane,
  colliderPane,
  jointPane,
  audioSourcePane,
  audioListenerPane,
  scriptPane,
  prefabInstancePane,
  playerControllerPane,
  waterPane,
];

/** What "Add" creates. A type that is only ever attached to an entity — a collider, a script — offers nothing. */
const ADD_MENUS: readonly AddMenuGroup[] = [
  meshMenu,
  lightMenu,
  cameraMenu,
  audioSourceMenu,
  audioListenerMenu,
  waterMenu,
  particleEmitterMenu,
];

/** What each type draws in the viewport. Every type answers: whether it draws geometry decides its marker. */
const OVERLAYS: readonly EntityOverlay[] = [
  meshOverlay,
  modelOverlay,
  lightOverlay,
  cameraOverlay,
  rigidbodyOverlay,
  colliderOverlay,
  jointOverlay,
  audioSourceOverlay,
  audioListenerOverlay,
  scriptOverlay,
  prefabInstanceOverlay,
  playerControllerOverlay,
  waterOverlay,
  particleEmitterOverlay,
];

/** Registers the kernel's panes, Add menu groups, viewport overlays and Hierarchy icons. Disposing takes them out again. */
export function activateEditor(registries: EditorRegistries): Disposable {
  return combineDisposables([
    ...PANES.map((pane) => registries.panes.register(pane)),
    ...ADD_MENUS.map((group) => registries.addMenu.register(group)),
    ...OVERLAYS.map((overlay) => registries.overlays.register(overlay)),
    ...HIERARCHY_ICONS.map((icon) => registries.icons.register(icon)),
  ]);
}
