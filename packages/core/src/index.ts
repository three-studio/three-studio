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
  ExportProgress,
  ExportResult,
  SceneChange,
  ScriptBuildResult,
  StudioBridge,
  WindowRole,
} from './bridge';

export {
  ASSETS_DIR,
  CACHE_DIR,
  DEFAULT_BUILD_PROFILE_ID,
  PROJECT_FILE_NAME,
  SCENES_DIR,
  createBuildProfiles,
  createPhysicsSettings,
  createRenderingSettings,
  findScene,
  resolveScene,
  sceneName,
} from './project/schema';

export {
  ASSET_MANIFEST_VERSION,
  ASSET_META_SUFFIX,
  ASSET_META_VERSION,
  BUILD_FORMAT_VERSION,
  MATERIAL_ASSET_VERSION,
  emptyManifest,
  hasImagePreview,
  isTslMaterial,
} from './assets/schema';
export type {
  AssetEntry,
  AssetImportResult,
  AssetKind,
  AssetManifest,
  AssetMeta,
  AssetSettings,
  AudioSettings,
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
  field,
  importerForFile,
  importPreviewUrl,
  parseImportPreviewUrl,
  importers,
} from './assets/import';
export type {
  ImportAction,
  ImportConflict,
  ImportEnum,
  ImportField,
  ImportGroup,
  ImportNumber,
  ImportOption,
  ImportPlanItem,
  ImportPreviewRequest,
  ImportSessionState,
  ImportToggle,
  StagedFile,
  TextReader,
} from './assets/import';

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

export {
  GEOMETRY_LABELS,
  createAudioListenerEntity,
  createAudioSource,
  createAudioSourceEntity,
  createBoxGeometry,
  createCameraEntity,
  createEmptyScene,
  createEntity,
  createEnvironment,
  createGeometry,
  createLightEntity,
  createMaterial,
  createMeshComponent,
  createMeshEntity,
  createModelEntity,
  createNewScene,
  createPrefabInstance,
  createShadowSettings,
  createSkySettings,
  createStarterScene,
  createTransform,
  createWater,
  createWaterEntity,
  isPlaceable,
  restingOffsetY,
} from './scene/defaults';
export type { EntityTemplate } from './scene/defaults';

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
  componentAssets,
  componentDefinition,
  componentDefinitions,
  createComponent,
  createComponentForEntity,
  defineComponent,
  fillComponent,
  typesWithoutRuntime,
} from './components';
export type { ComponentDefinition, ComponentIcon } from './components';

export { deserializeScene, serializeScene } from './scene/serialization';

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
  emptyLayoutPreferences,
} from './preferences/schema';
export type {
  LayoutPreferences,
  LayoutTemplateRecord,
  SerializedLayout,
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
