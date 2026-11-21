/*
 * The public surface of the runtime.
 *
 * Inside the monorepo the apps reach modules directly — `@three-studio/runtime/world/World`
 * and friends — because Vite aliases the scope onto `src/`. Published, there is only
 * this barrel: the package exports one entry point, so anything a consumer is meant
 * to reach has to be named here.
 *
 * Re-exports are explicit rather than `export *` on purpose. Three names collide
 * across modules — `Behaviour` (the script base class in `scripting/ScriptApi`, the
 * component-behaviour interface in `behaviour/Behaviour`), `isVisibleInHierarchy`
 * and `isStopped` — and a star re-export would silently drop one side of each.
 */

import { ENGINE_VERSION } from '@three-studio/core';

/**
 * The same number as the editor's, because they ship together.
 *
 * It was a second copy of the string, which is a third if the `package.json`
 * beside it counts — and a version that can disagree with itself answers no
 * question anyone asks it. Nothing in this repository reads it; it is here for
 * a consumer of the published package, which is why it is still exported.
 */
export const RUNTIME_VERSION = ENGINE_VERSION;

/* The world: a scene document running, and the scene graph a host draws. */
export { World, isPerspective } from './world/World';
export type { Phase, Subsystem, SubsystemDefinition, WorldMode, WorldOptions, WorldRegistries } from './world/World';
export { EntityChannel } from './world/channel';
export { CAMERA_PRIORITY, CameraClaims } from './world/cameras';
export { SunService } from './world/sun';
export type { Sun, SunSource } from './world/sun';
/* What a game is built from, made and filled by each app's composition root. */
export { activateRuntime, createRuntimeRegistries } from './registries';
export type { RuntimeRegistries } from './registries';
export type { BehaviourDefinition } from './behaviour/Behaviour';
/* What a component type's system is written with, in the kernel or in a module. */
export { ComponentSystem, defineSystem } from './systems/ComponentSystem';
export type { SystemContext, SystemDefinition, SystemHandle } from './systems/ComponentSystem';
export { SceneHost } from './SceneHost';
export type { SceneHostOptions, SceneLoad, SceneSource } from './SceneHost';
export { ENTITY_ID_KEY, SceneBinder, bindScene, isVisibleInHierarchy } from './SceneBinder';
export type { SceneBinderOptions } from './SceneBinder';
export { MeshBatcher } from './MeshBatcher';
export { Reconciler } from './Reconciler';
export type { EntityView } from './Reconciler';

/* Rendering. `createRenderer` picks WebGPU and falls back to WebGL. */
export { createRenderer, rendererCount } from './RendererFactory';
export type { CreateRendererOptions, RendererBackend, RendererHandle } from './RendererFactory';

/* Time. One clock for the simulation and every node material; see `time/StudioTime`. */
export { StudioTime } from './time/StudioTime';

/* Assets: resolving ids to URLs, holding what is loaded, applying import settings. */
export { NULL_ASSET_RESOLVER } from './assets/AssetResolver';
export type { AssetResolver } from './assets/AssetResolver';
export { AssetCache } from './assets/AssetCache';
export type { ModelHold, PreloadHold, TextureHold } from './assets/AssetCache';
export { disposeModel, extensionOf, loadModelFromUrl } from './assets/loadModel';
export type { LoadedModel } from './assets/loadModel';
export { applyModelSettings, applyTextureSettings } from './assets/importSettings';
export { describeNodes, resolveNode } from './assets/modelNodes';
export type { ModelNodeDesc, ModelShape } from './assets/modelNodes';

/* Audio. The `*Like` types exist so the mixer can be driven by a fake context in tests. */
export { AudioEngine } from './audio/AudioEngine';
export { audioOf } from './audio/audioOf';
export type { AudioEngineOptions } from './audio/AudioEngine';
export type { AudioApi, AudioScriptMembers } from './audio/scriptMembers';
export { isStopped } from './audio/AudioContextLike';
export type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioContextStateLike,
  AudioListenerLike,
  AudioNodeLike,
  AudioParamLike,
  GainNodeLike,
  PannerNodeLike,
} from './audio/AudioContextLike';
export type { ClipLoader } from './audio/AudioClipCache';
export { failedVoice } from './audio/playback';
export type {
  PlayRequest,
  SpatialRequest,
  Vec3Tuple,
  VoiceEvent,
  VoiceHandle,
  VoiceState,
} from './audio/playback';

/* Physics. Our types only: nothing of Rapier's is on this barrel. */
export { PhysicsWorld, applyWorldTransform, jointPose, worldPose } from './physics/PhysicsWorld';
export type { DebugLines } from './physics/PhysicsWorld';
export { collisionsOf, physicsDebugLines, physicsOf } from './physics/physicsOf';
export type { PhysicsScriptMembers, ScriptPhysics } from './physics/scriptMembers';
export { collectVertices, ownMeshes } from './physics/meshShape';
export type {
  BodyHandle,
  CharacterController,
  CharacterSettings,
  Collision,
  JointHandle,
  PhysicsApi,
  QuatLike,
  QueryFilter,
  QueryOptions,
  RaycastHit,
  Touch,
  Vec3Like,
} from './physics/PhysicsApi';

/*
 * Scripting: the base class user scripts extend, and what a compiled bundle's
 * classes are once the host has decoded them — handed to the world that runs
 * them, never filed in a table of the page's. What a feature gives scripts is
 * its contribution, and a project's typings are written from the registries.
 */
export { Behaviour } from './scripting/ScriptApi';
export type { ScriptMembers, ScriptProperties, ScriptPropertyDef } from './scripting/ScriptApi';
export type { Entity, EntityTransform, PlaceOptions, ScriptWorld, SpawnOptions } from './scripting/Entity';
export type { ScriptMembersDefinition, ScriptSite } from './scripting/members';
export { reservedScriptNames, scriptTypings } from './scripting/typings';
export { NO_SCRIPTS, publishScriptApi, scriptClassesOf } from './scripting/scriptBundle';
export type { ScriptClass, ScriptClasses } from './scripting/scriptBundle';

/* Input and the built-in character controller. */
export { Input, type InputOptions } from './input/Input';
export { inputOf } from './input/inputOf';
export { PressedKeys, type KeyEventLike } from './input/PressedKeys';
export { PlayerController } from './controllers/PlayerController';
