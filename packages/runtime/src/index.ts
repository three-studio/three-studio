/*
 * The public surface of the runtime.
 *
 * Inside the monorepo the apps reach modules directly — `@three-studio/runtime/Engine`
 * and friends — because Vite aliases the scope onto `src/`. Published, there is only
 * this barrel: the package exports one entry point, so anything a consumer is meant
 * to reach has to be named here.
 *
 * Re-exports are explicit rather than `export *` on purpose. Three names collide
 * across modules — `Behaviour` (the script base class in `scripting/ScriptApi`, the
 * component-behaviour interface in `behaviour/Behaviour`), `isVisibleInHierarchy`
 * and `isStopped` — and a star re-export would silently drop one side of each.
 */

export const RUNTIME_VERSION = '0.1.0';

/* The engine loop and the scene it drives. */
export { Engine, isPerspective } from './Engine';
export type { EngineOptions } from './Engine';
export { SceneHost } from './SceneHost';
export type { SceneHostOptions, SceneLoad, SceneSource } from './SceneHost';
export { ENTITY_ID_KEY, SceneBinder, isVisibleInHierarchy } from './SceneBinder';
export { MeshBatcher } from './MeshBatcher';
export { Reconciler } from './Reconciler';
export type { EntityView } from './Reconciler';

/* Rendering. `createRenderer` picks WebGPU and falls back to WebGL. */
export { createRenderer, rendererCount } from './RendererFactory';
export type { CreateRendererOptions, RendererBackend, RendererHandle } from './RendererFactory';

/* Time. One clock for the simulation and every node material; see `time/StudioTime`. */
export { StudioTime, studioTime } from './time/StudioTime';

/* Assets: resolving ids to URLs, loading models, applying import settings. */
export { NULL_ASSET_RESOLVER } from './assets/AssetResolver';
export type { AssetResolver } from './assets/AssetResolver';
export { MODEL_EXTENSIONS, extensionOf, loadModelFromUrl } from './assets/loadModel';
export type { LoadedModel } from './assets/loadModel';
export { applyModelSettings, applyTextureSettings } from './assets/importSettings';
export { describeNodes, resolveNode } from './assets/modelNodes';
export type { ModelNodeDesc, ModelShape } from './assets/modelNodes';

/* Audio. The `*Like` types exist so the mixer can be driven by a fake context in tests. */
export { AudioEngine } from './audio/AudioEngine';
export type { AudioEngineOptions } from './audio/AudioEngine';
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
export { failedVoice } from './audio/playback';
export type {
  PlayRequest,
  SpatialRequest,
  Vec3Tuple,
  VoiceEvent,
  VoiceHandle,
  VoiceState,
} from './audio/playback';

/* Physics. */
export { FIXED_STEP, PhysicsWorld, applyWorldTransform } from './physics/PhysicsWorld';
export type { PhysicsBody } from './physics/PhysicsWorld';

/* Scripting: the base class user scripts extend, and the registry the host compiles into. */
export { Behaviour, RESERVED_PROPERTY_NAMES } from './scripting/ScriptApi';
export type { EntityHandle, ScriptProperties, ScriptPropertyDef } from './scripting/ScriptApi';
export { clearScripts, registerScript, scriptClassFor } from './scripting/ScriptHost';
export type { ScriptClass } from './scripting/ScriptHost';

/* Input and the built-in character controller. */
export { Input } from './input/Input';
export { PressedKeys, type KeyEventLike } from './input/PressedKeys';
export { PlayerController } from './controllers/PlayerController';
