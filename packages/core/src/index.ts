export {
  ENGINE_NAME,
  ENGINE_VERSION,
  PROJECT_FORMAT_VERSION,
  PREFAB_FORMAT_VERSION,
  PREFAB_ID_SEPARATOR,
  SCENE_FORMAT_VERSION,
  SCRIPT_API_VERSION,
} from './constants';
export { createId } from './ids';
export type {
  Platform,
  ProjectApi,
  ScriptApi,
  BuildApi,
  BuildSize,
  ExportProgress,
  ExportResult,
  SceneChange,
  ScriptBuildResult,
  StudioBridge,
  WindowRole,
} from './bridge';
/* The wiring the two sides of the boundary derive from, rather than repeat. */
export type { BridgeHandlers, InvokeChannels } from './bridge';
export { IPC_EVENTS, IPC_INVOKE } from './bridge';

export {
  ASSETS_DIR,
  CACHE_DIR,
  DEFAULT_BUILD_PROFILE_ID,
  PROJECT_FILE_NAME,
  SCENES_DIR,
  SCENE_FILE_SUFFIX,
  basePathProblem,
  createBuildProfiles,
  createPhysicsSettings,
  createRenderingSettings,
  findScene,
  normalizeBasePath,
  normalizeBuildProfiles,
  resolveScene,
  sceneName,
} from './project/schema';

export {
  ASSET_MANIFEST_VERSION,
  ASSET_META_SUFFIX,
  ASSET_META_VERSION,
  BUILD_FORMAT_VERSION,
  MATERIAL_ASSET_VERSION,
  buildScenePath,
  applyAssetChange,
  emptyAssetChange,
  emptyManifest,
  hasImagePreview,
  isTslMaterial,
} from './assets/schema';
export type {
  AssetEntry,
  AssetImportResult,
  AssetKind,
  AssetChange,
  AssetManifest,
  AssetMeta,
  AssetSettings,
  AudioSettings,
  BuildManifest,
  FbxModelSettings,
  GltfModelSettings,
  MaterialAssetFile,
  MaterialSettings,
  ModelSettings,
  ModelSettingsBase,
  ObjModelSettings,
  PrefabSettings,
  ScriptSettings,
  ShaderSettings,
  TextureEncoding,
  TextureSettings,
} from './assets/schema';

/* How a file in the project is addressed from a page. */
export { ASSET_HOST, ASSET_SCHEME, assetUrl, encodePath } from './assets/url';

export {
  ASSET_KIND_INFO,
  AssetImporter,
  FIT_TO_METRE,
  IMPORT_HOST,
  IMPORT_SCHEME,
  ImporterRegistry,
  ModelImporter,
  assetDisplayName,
  assetKindForFile,
  defaultSettings,
  importerForFile,
  importPreviewUrl,
  parseImportPreviewUrl,
  importers,
} from './assets/import';
export type {
  ImportConflict,
  ImportPlanItem,
  ImportPreviewRequest,
  ImportSessionState,
  StagedFile,
  TextReader,
} from './assets/import';

/*
 * The field vocabulary sits at the root of `core` rather than under the
 * importers, because it stopped belonging to them: a script declares in it too,
 * and `ScriptPropertyDef` in the runtime is now an alias of `FieldDef`.
 */
export { field, fieldOptions, optionsFrom } from './fields';
/* What the renderer sends, made safe before it reaches the disk. */
export {
  conform,
  conformAssetSettings,
  conformLayoutPreferences,
  conformShortcutPreferences,
  conformMaterial,
  conformPatch,
  conformSettingsPatch,
} from './guards';
export type {
  FieldAction,
  FieldDef,
  FieldGroup,
  FieldOption,
  FieldRow,
} from './fields';

export {
  collectSceneAssets,
  environmentAssets,
  findAssetUsage,
  findPrefabInstances,
  isUsed,
  totalUses,
} from './assets/references';
export type { AssetUsage } from './assets/references';
export type {
  BuildProfile,
  BuildProfiles,
  BuildTargetId,
  OpenProject,
  PhysicsSettings,
  ProjectContents,
  ProjectFile,
  ProjectSettings,
  SceneEntry,
  ProjectSummary,
  RenderingSettings,
} from './project/schema';

export type {
  AudioBus,
  AudioListenerComponent,
  AudioSourceComponent,
  CameraComponent,
  ColliderComponent,
  ComponentDoc,
  ComponentOfType,
  ComponentTables,
  ComponentType,
  EntityDoc,
  EnvironmentDef,
  GeometryDef,
  GeometryKind,
  Hex,
  LightComponent,
  LightKind,
  MaterialDef,
  MaterialSide,
  MeshComponent,
  PrefabInstanceComponent,
  PrefabOverride,
  ModelComponent,
  EmitterShape,
  ParticleEmitterComponent,
  PlayerControllerComponent,
  RigidBodyComponent,
  SceneDoc,
  ScriptComponent,
  ScriptPropValue,
  ShadowSettings,
  SkySettings,
  Transform,
  Vec3,
  WaterComponent,
  WaterSunSource,
} from './scene/schema';

/* Water's sun: which one, and where the sky's is. */
export { SUN_CUSTOM, SUN_FROM_SKY, isEntitySun, skySunDirection } from './scene/water';

export { AUDIO_BUSES } from './scene/schema';

/*
 * A label for each member of a closed union, beside the union it names — see
 * the note in `scene/schema.ts`. Total records, so the compiler is what makes a
 * member without a name impossible; `optionsFrom` turns one into the choices a
 * control offers.
 */
export {
  AUDIO_BUS_LABELS,
  BACKGROUND_MODE_LABELS,
  BODY_TYPE_LABELS,
  CAMERA_PROJECTION_LABELS,
  COLLIDER_SHAPE_LABELS,
  DISTANCE_MODEL_LABELS,
  EMITTER_SHAPE_LABELS,
  ENVIRONMENT_MODE_LABELS,
  FOG_MODE_LABELS,
  MATERIAL_SIDE_LABELS,
  PLAYER_CONTROLLER_MODE_LABELS,
  TEXTURE_WRAP_LABELS,
} from './scene/schema';
export type {
  BackgroundMode,
  BodyType,
  ColliderShape,
  DistanceModel,
  EnvironmentMode,
  FogMode,
  PlayerControllerMode,
} from './scene/schema';

export {
  createEmptyScene,
  createEnvironment,
  createNewScene,
  createSkySettings,
  createStarterScene,
} from './scene/defaults';
export { createEntity, createTransform } from './scene/entity';
/* The two shared vocabularies a component is built out of. */
export { GEOMETRY_LABELS, createBoxGeometry, createGeometry, restingOffsetY } from './scene/geometry';
export { createMaterial } from './scene/material';
export type { EntityTemplate } from './scene/entity';
/* Each slice's own factories, from the slice that owns them. */
export { createAudioListenerEntity } from './components/audioListener/defaults';
export { createAudioSource, createAudioSourceEntity } from './components/audioSource/defaults';
export { createCameraEntity } from './components/camera/defaults';
export { createLightEntity, createShadowSettings } from './components/light/defaults';
export { createMeshComponent, createMeshEntity } from './components/mesh/defaults';
export { createModelEntity } from './components/model/defaults';
export { createPrefabInstance } from './components/prefabInstance/defaults';
export { createWater, createWaterEntity } from './components/water/defaults';
export {
  createParticleEmitter,
  createParticleEmitterEntity,
} from './components/particleEmitter/defaults';

/* The component tables: every read and write of `scene.components`. */
export {
  COMPONENT_TYPES,
  componentsOf,
  componentsOfType,
  copyComponentsOf,
  deleteComponent,
  dropComponentsOf,
  emptyComponentTables,
  entitiesWith,
  findComponent,
  findComponentById,
  hasComponent,
  isKnownComponentType,
  putComponent,
  setComponentsOf,
} from './scene/components';
export type { ComponentHost } from './scene/components';

export {
  addableTypes,
  componentAssets,
  componentDefinition,
  componentDefinitions,
  createComponent,
  createComponentForEntity,
  defineComponent,
  fillComponent,
  isPlaceable,
  typesWithoutRuntime,
} from './components';
export type { ComponentDefinition, ComponentIcon } from './components';

export { deserializeScene, serializeScene } from './scene/serialization';
export { stableJson } from './json';
/* One rule for a name that has to become a file. */
export { FORBIDDEN_FILE_NAME_CHARS, safeFileName } from './files';

export {
  applyPrefabOverride,
  createPrefabDoc,
  expandPrefabs,
  instanceOwnerOf,
  instancedId,
  migratePrefab,
  prefabFromEntities,
  prefabInstanceOf,
  prefabToScene,
  prefabVariantOf,
  sceneToPrefab,
  splitInstancedId,
  variantBaseOf,
} from './scene/prefab';
export type { ExpandedScene, PrefabDoc, PrefabLibrary } from './scene/prefab';

export {
  LAYOUT_PREFERENCES_VERSION,
  SHORTCUT_PREFERENCES_VERSION,
  emptyLayoutPreferences,
  emptyShortcutPreferences,
} from './preferences/schema';
export type {
  LayoutPreferences,
  LayoutTemplateRecord,
  SerializedLayout,
  ShortcutPreferences,
} from './preferences/schema';

export { capabilitiesOf } from './scene/capabilities';
export type { EntityCapability } from './scene/capabilities';

export { entitiesFromNodes } from './scene/modelUnpack';
export type { ModelNode, UnpackedEntity } from './scene/modelUnpack';

export {
  collectDescendants,
  cycles,
  entityWorldMatrixPath,
  isAncestorOf,
} from './scene/query';

/*
 * The hierarchy is edited through here and nowhere else. Every one of these
 * refuses rather than corrupts, and returns instead of throwing — see the header
 * of `scene/graph.ts` for why both matter.
 */
export {
  cloneSubtree,
  insertEntity,
  linkEntity,
  removeSubtree,
  reparentEntity,
  unlinkEntity,
  validateHierarchy,
} from './scene/graph';
