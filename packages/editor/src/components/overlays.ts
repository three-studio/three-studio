/*
 * What every component type contributes to the viewport, assembled.
 *
 * Total, for the reason `panes.ts` gives, and separate from it for the reason
 * it gives too: this half is read from inside the viewport and must not reach
 * the commands the panes run.
 */
import type { ComponentType } from '@three-studio/core';
import * as audioListener from './audioListener/overlay';
import * as audioSource from './audioSource/overlay';
import * as camera from './camera/overlay';
import * as collider from './collider/overlay';
import * as light from './light/overlay';
import * as mesh from './mesh/overlay';
import * as model from './model/overlay';
import * as particleEmitter from './particleEmitter/overlay';
import * as playerController from './playerController/overlay';
import * as prefabInstance from './prefabInstance/overlay';
import type { EntityOverlay } from './registry';
import * as rigidbody from './rigidbody/overlay';
import * as script from './script/overlay';
import * as water from './water/overlay';

export const OVERLAYS: Record<ComponentType, EntityOverlay> = {
  mesh,
  model,
  water,
  particleEmitter,
  light,
  camera,
  rigidbody,
  collider,
  audioSource,
  audioListener,
  script,
  prefabInstance,
  playerController,
};
