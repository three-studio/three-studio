import {
  SUN_CUSTOM,
  SUN_FROM_SKY,
  entitiesWith,
  type ComponentDoc,
  type ComponentType,
  type EnvironmentDef,
  type GeometryKind,
  type MaterialDef,
  type SceneDoc,
  type SkySettings,
} from '@three-studio/core';
import type { BindingParams } from 'tweakpane';
import {
  ASSET_SLOT,
  GEOMETRY_FIELDS,
  MATERIAL_FIELDS,
  SIDE_OPTIONS,
  asDegrees,
  asVec2,
  asVec3,
  assetSlot,
  isGeometrySlot,
  textureSlot,
  type ComponentSchema,
  type FieldSpec,
  type GeometrySlotSpec,
  type PaneEntry,
} from './fields';
import { inspector as audioListenerInspector } from '../components/audioListener/inspector';
import { inspector as lightInspector } from '../components/light/inspector';
import { shapeOf } from './signature';
import { setComponentNestedField } from '../commands/sceneCommands';
import {
  applyInstanceOverrides,
  createPrefabVariant,
  instanceInfo,
  revertInstanceOverrides,
  selectPrefabInstances,
  unpackPrefabInstance,
} from '../commands/prefabCommands';
import { audioPreview } from '../audio/preview';
import { peekViewport } from '../viewport/viewportHost';
import { useAssetStore } from '../state/assetStore';
import { unpackModel } from '../commands/modelCommands';
import { usePrefabModeStore } from '../state/prefabModeStore';
import { askForText } from '../state/dialogStore';
import { useDocumentStore } from '../state/documentStore';
import { expandedScene } from '../state/expansion';
import { useScriptStore } from '../state/scriptStore';

/*
 * The field vocabulary lives in `fields.ts` and is re-exported here.
 *
 * A slice is written in that vocabulary and this file imports the slices, so
 * the two cannot share a module. Nothing that reads a pane had to move: this
 * is still the door.
 */
export {
  ASSET_SLOT,
  GEOMETRY_FIELDS,
  MATERIAL_FIELDS,
  SIDE_OPTIONS,
  asDegrees,
  asVec2,
  asVec3,
  assetSlot,
  isAction,
  isGeometrySlot,
  isSeparator,
  textureSlot,
  type ActionSpec,
  type BoundSpec,
  type ComponentSchema,
  type FieldSpec,
  type GeometrySlotSpec,
  type PaneEntry,
  type SeparatorSpec,
} from './fields';

/**
 * Writes the embedded material out as an asset and links the mesh to it.
 *
 * Two writes, deliberately: the file first, so a failed write leaves the mesh
 * pointing at its own material rather than at an id that does not exist.
 */
async function extractMaterial(
  entityId: string,
  componentId: string,
  material: MaterialDef,
): Promise<void> {
  const suggested = expandedScene().scene.entities[entityId]?.name ?? 'Material';
  const name = await askForText({
    title: 'Save Material as Asset',
    label: 'Name',
    defaultValue: `${suggested} Material`,
    confirmLabel: 'Create',
  });
  if (name === null) return;

  const assetId = await useAssetStore.getState().createMaterial(name, material);
  setComponentNestedField(entityId, componentId, ['materialId'], assetId);
}

/** Whether a water surface is lit by its own two fields rather than the scene. */
const isCustomSun = (component: ComponentDoc): boolean =>
  component.type === 'water' && component.sunSource === SUN_CUSTOM;

/** 3D falloff only matters once a source has some spatial blend. */
const isPositional = (component: ComponentDoc) =>
  component.type === 'audioSource' && component.spatialBlend > 0;


export const COMPONENT_SCHEMAS: Record<ComponentType, ComponentSchema> = {
  mesh: {
    /*
     * Not "Mesh Renderer", which is what it said and what it is not.
     *
     * Unity's MeshRenderer draws whatever a MeshFilter points at; this owns a
     * `GeometryDef`, and `GeometryDef` is thirteen primitives with no way to
     * name a file. So "Add Component ▸ Mesh Renderer" on an imported model read
     * as "give this model a material" and produced a grey 1×1×1 box beside it —
     * correct behaviour of a name that promised something else. Giving a model a
     * material is `model`'s own row now, and this is a primitive again.
     */
    label: 'Mesh',
    fields: [
      { path: ['castShadow'], label: 'Cast shadows' },
      { path: ['receiveShadow'], label: 'Receive shadows' },
      // Shape first: it is what the object *is*, and a displacement map is
      // useless without the segment counts that live here.
      { kind: 'separator' },
      { kind: 'geometry' },
      { kind: 'separator' },
      {
        path: ['materialId'],
        label: 'Material',
        params: { view: 'asset', assetKind: 'material' },
        toModel: (value) => value ?? '',
        fromModel: (value) => (value === '' ? null : value),
      },
      {
        kind: 'action',
        title: 'Save as Asset…',
        // Extraction on demand, as in Godot. Unity and Unreal are asset-first —
        // a new object gets a read-only default and any edit forces you to
        // create an asset — which is consistent but means a file per tinted
        // cube. Here the file appears when sharing is actually wanted.
        visibleWhen: (component) => component.type === 'mesh' && component.materialId === null,
        run: ({ entityId, componentId, component }) => {
          if (component.type !== 'mesh') return;
          void extractMaterial(entityId, componentId, component.material);
        },
      },
      {
        kind: 'action',
        title: 'Make Unique',
        visibleWhen: (component) => component.type === 'mesh' && component.materialId !== null,
        run: ({ entityId, componentId, component }) => {
          if (component.type !== 'mesh' || component.materialId === null) return;
          // Copy the shared values in before unlinking, so the object keeps the
          // look it had. Detaching to whatever was embedded before would look
          // like the material was lost.
          const shared = useAssetStore.getState().materials[component.materialId];
          if (shared) setComponentNestedField(entityId, componentId, ['material'], { ...shared });
          setComponentNestedField(entityId, componentId, ['materialId'], null);
        },
      },
      ...MATERIAL_FIELDS,
    ],
  },
  model: {
    label: 'Model',
    fields: [
      { path: ['castShadow'], label: 'Cast shadows' },
      { path: ['receiveShadow'], label: 'Receive shadows' },
      { kind: 'separator' },
      {
        /*
         * The one thing an imported model had no way at all to express.
         *
         * The same row `mesh` carries, and deliberately so: a material asset is
         * a material asset, and the author should not have to learn that giving
         * one to a cube and giving one to a chair are different gestures. Empty
         * keeps the materials the file shipped with, which is what every model
         * did before this existed.
         *
         * There is no "Save as Asset…" beside it, unlike `mesh`. A model has no
         * embedded `MaterialDef` to extract — its materials live inside the
         * file, and pulling one out means decoding the images it references,
         * which is an import question rather than an inspector one.
         */
        path: ['materialId'],
        label: 'Material',
        // "From file", not the mesh's "Embedded": a model has no embedded
        // `MaterialDef` to fall back on, it has whatever the glTF shipped with.
        params: { view: 'asset', assetKind: 'material', emptyLabel: 'From file' },
        toModel: (value) => value ?? '',
        fromModel: (value) => (value === '' ? null : value),
      },
      { kind: 'separator' },
      {
        kind: 'action',
        title: 'Unpack Model',
        // Unity's "Unpack Prefab", for a file: one entity per node, each of them
        // movable, hideable and re-materialable on its own. One-way, which is
        // why it is a button and not a checkbox — and offered only on the entity
        // that still draws the whole thing.
        visibleWhen: (component) => component.type === 'model' && component.nodePath === '',
        run: ({ entityId }) => void unpackModel(entityId),
      },
    ],
  },
  water: {
    label: 'Water',
    fields: [
      // Shape first, as on a mesh: it is what the object *is*. Written out
      // rather than taken from the `{ kind: 'geometry' }` slot, which switches
      // over all thirteen primitives — a water surface is always a plane.
      { path: ['geometry', 'width'], label: 'Width', params: { min: 0.01, step: 0.5 } },
      { path: ['geometry', 'height'], label: 'Height', params: { min: 0.01, step: 0.5 } },
      { kind: 'separator' },
      assetSlot(['normalMapId'], 'Normal map'),
      { path: ['waterColor'], label: 'Colour' },
      { path: ['alpha'], label: 'Opacity', params: { min: 0, max: 1, step: 0.01 } },
      // `size` is spatial, not temporal: it scales the world position the noise
      // is read at, so larger is choppier rather than faster. Labelled for what
      // it does, since "Size" beside a Width and a Height reads as a third one.
      { path: ['size'], label: 'Ripple scale', params: { min: 0.01, max: 20, step: 0.01 } },
      // Beside `Ripple scale`, its twin: that one is the pattern in space, this
      // one is the pattern in time. The scene's timescale still multiplies it,
      // so Pause stops a surface however fast it is set.
      { path: ['speed'], label: 'Speed', params: { min: 0, max: 5, step: 0.05 } },
      { path: ['direction'], label: 'Direction', params: { min: 0, max: 360, step: 1 }, ...asDegrees },
      { path: ['choppiness'], label: 'Choppiness', params: { min: 0.1, max: 5, step: 0.05 } },
      { path: ['distortionScale'], label: 'Distortion', params: { min: 0, max: 100, step: 0.5 } },
      { kind: 'separator' },
      {
        path: ['sunSource'],
        label: 'Sun',
        // One control for a question with one answer: the sky, a light in the
        // scene, or two fields of your own. A dropdown rather than a reference
        // picker because the first and last options are not entities, and a
        // picker that had to carry them would be two controls pretending to be
        // one.
        optionsProvider: () => {
          const scene = useDocumentStore.getState().scene;
          const lights = entitiesWith(scene, 'light')
            .map((id) => scene.entities[id])
            .filter((entity) => entity !== undefined);
          return {
            'Sky (scene sun)': SUN_FROM_SKY,
            ...Object.fromEntries(lights.map((entity) => [entity.name, entity.id])),
            Custom: SUN_CUSTOM,
          };
        },
      },
      {
        path: ['sunDirection'],
        label: 'Sun direction',
        ...asVec3,
        visibleWhen: isCustomSun,
      },
      { path: ['sunColor'], label: 'Sun colour', visibleWhen: isCustomSun },
      { kind: 'separator' },
      {
        path: ['resolutionScale'],
        label: 'Reflection quality',
        // Stepped coarsely, and no longer because it rebuilds the shader — the
        // fork made it writable in place. `RenderTarget.setSize` still disposes
        // and rebuilds the reflection buffer on any real change, so a coarse
        // step turns a drag into about eighteen reallocations instead of sixty
        // a second.
        params: { min: 0.1, max: 1, step: 0.05 },
      },
      { path: ['side'], label: 'Side', params: { options: SIDE_OPTIONS } },
      { path: ['fog'], label: 'Affected by fog' },
    ],
  },
  /*
   * No `kind` field, deliberately.
   *
   * A light's kind is chosen when it is added — `Add > Light >` offers all seven
   * — and changing it afterwards is a different light, not an edited one: three
   * builds a different class per kind, which is why `LightSystem.patch` answers
   * `'remount'` and throws away the shadow map. Godot draws the same line, with
   * a node class per kind. The engine keeps the capability, for a hand-edited
   * file or a prefab; only the UI stops offering the gesture.
   *
   * A projector is a spot that throws a picture, so it appears beside `spot` in
   * every predicate below rather than getting a group of its own.
   */
  light: lightInspector,
  camera: {
    label: 'Camera',
    fields: [
      {
        path: ['projection'],
        label: 'Projection',
        params: { options: { Perspective: 'perspective', Orthographic: 'orthographic' } },
      },
      {
        path: ['fov'],
        label: 'Field of view',
        params: { min: 10, max: 130, step: 1 },
        visibleWhen: (c) => c.type === 'camera' && c.projection === 'perspective',
      },
      {
        path: ['frustumSize'],
        label: 'Size',
        params: { min: 0.1, step: 0.5 },
        visibleWhen: (c) => c.type === 'camera' && c.projection === 'orthographic',
      },
      { path: ['near'], label: 'Near', params: { min: 0.001, step: 0.01 } },
      { path: ['far'], label: 'Far', params: { min: 1, step: 10 } },
      { path: ['isMain'], label: 'Main camera' },
    ],
  },
  rigidbody: {
    label: 'Rigid Body',
    fields: [
      {
        path: ['bodyType'],
        label: 'Type',
        params: {
          options: { Dynamic: 'dynamic', Fixed: 'fixed', Kinematic: 'kinematicPosition' },
        },
      },
      { path: ['mass'], label: 'Mass', params: { min: 0.001, step: 0.1 } },
      { path: ['linearDamping'], label: 'Linear damping', params: { min: 0, max: 10, step: 0.01 } },
      { path: ['angularDamping'], label: 'Angular damping', params: { min: 0, max: 10, step: 0.01 } },
      { path: ['gravityScale'], label: 'Gravity scale', params: { min: -5, max: 5, step: 0.1 } },
      { path: ['ccd'], label: 'Continuous detection' },
    ],
  },
  collider: {
    label: 'Collider',
    fields: [
      {
        path: ['shape'],
        label: 'Shape',
        params: {
          options: {
            Box: 'box',
            Sphere: 'sphere',
            Capsule: 'capsule',
            'Convex hull': 'convexHull',
            'Triangle mesh': 'trimesh',
          },
        },
      },
      {
        path: ['radius'],
        label: 'Radius',
        params: { min: 0.01, step: 0.05 },
        visibleWhen: (c) => c.type === 'collider' && (c.shape === 'sphere' || c.shape === 'capsule'),
      },
      {
        path: ['halfHeight'],
        label: 'Half height',
        params: { min: 0.01, step: 0.05 },
        visibleWhen: (c) => c.type === 'collider' && c.shape === 'capsule',
      },
      { path: ['friction'], label: 'Friction', params: { min: 0, max: 2, step: 0.01 } },
      { path: ['restitution'], label: 'Bounciness', params: { min: 0, max: 1, step: 0.01 } },
      { path: ['isSensor'], label: 'Is sensor' },
    ],
  },
  audioSource: {
    label: 'Audio Source',
    fields: [
      // First, because everything below it is a way of shaping *this*. The
      // component has carried an `assetId` since the day it was added to the
      // schema and there was no way to fill it in until now.
      {
        path: ['assetId'],
        label: 'Clip',
        params: { view: 'asset', assetKind: 'audio' },
        toModel: (value) => value ?? '',
        fromModel: (value) => (value === '' ? null : value),
      },
      // Auditioned through the editor's own engine, never the game's: stopping
      // play must not stop a preview, and a preview must not turn up in the
      // game's mix (ADR-4).
      {
        kind: 'action',
        label: 'Preview',
        title: '▶  Play',
        run: ({ entityId, componentId, component }) => {
          if (component.type !== 'audioSource') return;
          audioPreview.playSource(
            entityId,
            componentId,
            component,
            peekViewport()?.binder.containerFor(entityId) ?? null,
          );
        },
      },
      {
        kind: 'action',
        title: '▌▌  Pause',
        run: () => {
          if (audioPreview.paused) audioPreview.resume();
          else audioPreview.pause();
        },
      },
      { kind: 'action', title: '■  Stop', run: () => audioPreview.stop() },
      { kind: 'separator' },

      { path: ['volume'], label: 'Volume', params: { min: 0, max: 2, step: 0.01 } },
      { path: ['pitch'], label: 'Pitch', params: { min: 0.1, max: 4, step: 0.01 } },
      // Cents. ±100 is a semitone, ±1200 an octave — the unit a variation is
      // written in, where `pitch` is the one a designer reaches for.
      { path: ['detune'], label: 'Detune', params: { min: -1200, max: 1200, step: 1 } },
      { path: ['mute'], label: 'Mute' },
      { path: ['loop'], label: 'Loop' },
      { path: ['playOnStart'], label: 'Play on start' },
      { kind: 'separator' },

      { path: ['startOffset'], label: 'Start offset', params: { min: 0, step: 0.01 } },
      { path: ['delay'], label: 'Delay', params: { min: 0, step: 0.01 } },
      { path: ['fadeIn'], label: 'Fade in', params: { min: 0, max: 30, step: 0.01 } },
      { path: ['fadeOut'], label: 'Fade out', params: { min: 0, max: 30, step: 0.01 } },
      // `0` is the highest, as in Unity. Idle until the voice ceiling is
      // reached, and then it decides everything.
      { path: ['priority'], label: 'Priority', params: { min: 0, max: 256, step: 1 } },
      { kind: 'separator' },

      {
        path: ['bus'],
        label: 'Bus',
        params: {
          options: { Master: 'master', Music: 'music', SFX: 'sfx', UI: 'ui', Ambience: 'ambience' },
        },
      },
      { kind: 'separator' },

      // The same field twice, as a switch and as a dial.
      //
      // `spatialBlend` is a number and stays one: it is Unity's model, and
      // `Voice` honours it with a real crossfade between a flat branch and a
      // panned one, which is what lets a sound be pulled toward the ear without
      // losing where it is. But almost every source is at one end or the other,
      // and a slider is a poor way to ask a yes-or-no question — so the switch
      // is on top, writing 0 or 1, and the dial stays underneath for the sounds
      // that want to sit between them.
      //
      // Unchecking and rechecking gives 1, not whatever the dial said before:
      // `fromModel` is a pure function with nowhere to keep it.
      {
        path: ['spatialBlend'],
        label: 'Spatialize',
        toModel: (value) => Number(value) > 0,
        fromModel: (value) => (value ? 1 : 0),
      },
      {
        path: ['spatialBlend'],
        label: '2D  ↔  3D',
        params: { min: 0, max: 1, step: 0.01 },
      },
      {
        path: ['distanceModel'],
        label: 'Falloff',
        params: { options: { Inverse: 'inverse', Linear: 'linear', Exponential: 'exponential' } },
        visibleWhen: isPositional,
      },
      {
        path: ['refDistance'],
        label: 'Full volume within',
        params: { min: 0.1, max: 100, step: 0.1 },
        visibleWhen: isPositional,
      },
      {
        path: ['maxDistance'],
        label: 'Max distance',
        params: { min: 1, max: 2000, step: 1 },
        visibleWhen: isPositional,
      },
      {
        path: ['rolloffFactor'],
        label: 'Rolloff',
        params: { min: 0, max: 10, step: 0.1 },
        visibleWhen: isPositional,
      },
      {
        path: ['coneInnerAngle'],
        label: 'Cone inner',
        params: { min: 0, max: 360, step: 1 },
        visibleWhen: isPositional,
      },
      {
        path: ['coneOuterAngle'],
        label: 'Cone outer',
        params: { min: 0, max: 360, step: 1 },
        visibleWhen: isPositional,
      },
      {
        path: ['coneOuterGain'],
        label: 'Outside cone',
        params: { min: 0, max: 1, step: 0.01 },
        visibleWhen: isPositional,
      },
    ],
  },
  audioListener: audioListenerInspector,
  prefabInstance: {
    label: 'Prefab',
    fields: [
      {
        path: ['assetId'],
        label: 'Prefab',
        params: { view: 'asset', assetKind: 'prefab' },
        toModel: (value) => value ?? '',
        fromModel: (value) => (value === '' ? null : value),
      },
      {
        kind: 'action',
        title: 'Open Prefab',
        // Where a change to the prefab itself is made — adding a child, or
        // overriding something a scene cannot reach because it sits two
        // prefabs deep.
        run: ({ entityId }) => {
          const info = instanceInfo(entityId);
          if (info && !info.missing) void usePrefabModeStore.getState().open(info.assetId);
        },
      },
      {
        kind: 'action',
        title: 'Create Variant…',
        run: ({ entityId }) => {
          const info = instanceInfo(entityId);
          if (info && !info.missing) void createPrefabVariant(info.assetId);
        },
      },
      {
        kind: 'action',
        title: 'Show in Project',
        run: ({ entityId }) => {
          const info = instanceInfo(entityId);
          if (info && !info.missing) useAssetStore.getState().reveal(info.assetId);
        },
      },
      {
        kind: 'action',
        // Reads the count, so pressing Apply is an informed decision rather
        // than a hope.
        title: 'Select All Instances',
        run: ({ entityId }) => selectPrefabInstances(entityId),
      },
      {
        kind: 'action',
        title: 'Apply Overrides',
        // The other half of the prefab loop: an instance is where an edit is
        // convenient to make, and this is what sends it to every other copy.
        run: ({ entityId }) => void applyInstanceOverrides(entityId),
      },
      {
        kind: 'action',
        title: 'Revert Overrides',
        run: ({ entityId }) => revertInstanceOverrides(entityId),
      },
      {
        kind: 'action',
        title: 'Unpack',
        // Unity's "Unpack Prefab": the contents become ordinary entities and
        // stop following the asset. One-way, which is why it is a button and
        // not a checkbox.
        run: ({ entityId }) => unpackPrefabInstance(entityId),
      },
    ],
  },
  script: {
    label: 'Script',
    fields: [
      {
        path: ['assetId'],
        label: 'Script',
        optionsProvider: () => {
          const scripts = useAssetStore.getState().byKind('script');
          return {
            None: '',
            ...Object.fromEntries(scripts.map((asset) => [asset.name, asset.id])),
          };
        },
      },
    ],
  },
  playerController: {
    label: 'Player Controller',
    fields: [
      { path: ['mode'], label: 'Mode', params: { options: { FPS: 'fps', TPS: 'tps', Fly: 'fly' } } },
      { path: ['moveSpeed'], label: 'Move speed', params: { min: 0.1, max: 40, step: 0.1 } },
      {
        path: ['sprintMultiplier'],
        label: 'Sprint ×',
        params: { min: 1, max: 5, step: 0.1 },
      },
      { path: ['jumpHeight'], label: 'Jump height', params: { min: 0, max: 10, step: 0.1 } },
      {
        path: ['mouseSensitivity'],
        label: 'Mouse sensitivity',
        params: { min: 0.0002, max: 0.01, step: 0.0001 },
      },
      {
        path: ['eyeHeight'],
        label: 'Eye height',
        params: { min: 0, max: 4, step: 0.05 },
        visibleWhen: (c) => c.type === 'playerController' && c.mode === 'fps',
      },
      {
        path: ['cameraDistance'],
        label: 'Camera distance',
        params: { min: 0.5, max: 25, step: 0.1 },
        visibleWhen: (c) => c.type === 'playerController' && c.mode === 'tps',
      },
    ],
  },
};

// --- the scene itself --------------------------------------------------------

/**
 * A field of the scene pane, minus where it lives — that is `on` and `key`.
 *
 * The entity panes address a component by a `path`, which the builder then had
 * to cast back into a key to write (`setEnvironmentField(field as keyof
 * EnvironmentDef, …)`). That cast was unchecked in both directions: `path[1]`
 * is a `string | undefined` with nothing saying it names a real field, and a
 * typo in the table would have written a property no migration fills.
 */
/**
 * What a scene-pane predicate may read.
 *
 * Not the whole `SceneDoc`, and the narrowing is load-bearing. `sceneSignature`
 * takes an `EnvironmentDef` so that immer's identity keeps it cheap — a panel
 * keyed on it is not recomputed by every unrelated edit in the scene, and
 * `InspectorPanel` subscribes to `s.scene.environment` for the same reason.
 * That only works while a predicate needs nothing else to answer, so the type
 * says so rather than a comment asking nicely: a predicate that reaches for
 * `scene.name` stops compiling instead of quietly making the signature a lie.
 */
export type SceneSubject = Pick<SceneDoc, 'environment'>;

type SceneFieldBase = Omit<FieldSpec<SceneSubject>, 'path'>;

/**
 * One editable value of the scene, and which block of it holds that value.
 *
 * Naming the block rather than pathing into it makes both directions
 * exhaustive: `sceneFieldPath` cannot forget to read one, and `buildScene`
 * cannot forget to write one — adding a block is a compile error in two places
 * until it is handled, where a `readonly string[]` was a compile error in none.
 */
export type SceneField =
  | (SceneFieldBase & { on: 'scene'; key: 'name' })
  | (SceneFieldBase & { on: 'environment'; key: keyof EnvironmentDef })
  | (SceneFieldBase & { on: 'sky'; key: keyof SkySettings });

/** Where a field's value sits in the document, for reading it back. */
export function sceneFieldPath(field: SceneField): readonly string[] {
  switch (field.on) {
    case 'scene':
      return [field.key];
    case 'environment':
      return ['environment', field.key];
    case 'sky':
      return ['environment', 'sky', field.key];
  }
}

/**
 * One folder of the scene pane. The same shape as a `ComponentSchema`, because
 * it is bound by the same code — only the subject differs.
 */
export interface SceneSection {
  label: string;
  /**
   * Hides the whole folder rather than each of its fields.
   *
   * A folder whose every field is hidden still draws its own header, and a
   * "Sky" heading over nothing reads as a panel that failed to load.
   */
  visibleWhen?: (scene: SceneSubject) => boolean;
  fields: readonly SceneField[];
}

const isFogOn = (scene: SceneSubject) => scene.environment.fogEnabled;
const showsTexture = (scene: SceneSubject) => scene.environment.backgroundMode === 'texture';

/**
 * The background is an image, whatever it is an image of.
 *
 * Its intensity applies to both: a photograph goes through
 * `scene.backgroundIntensity`, and the analytic sky — which is a mesh, so
 * `scene.background` is null — through a uniform on its own material. See
 * `ProceduralSky`.
 */
const showsImageBackground = (scene: SceneSubject) => scene.environment.backgroundMode !== 'color';

/**
 * Something the shared rotation actually turns.
 *
 * Not the analytic sky: it is turned by its own `azimuth`, which moves the sun
 * with it. Offering a second angle that spins the whole capture underneath the
 * first is two controls fighting over one thing.
 */
const turnsAnImage = (scene: SceneSubject) =>
  scene.environment.backgroundMode === 'texture' ||
  scene.environment.environmentMode === 'texture';

/** The slot for an equirectangular image, shaped like the material ones. */
const environmentSlot = (key: keyof EnvironmentDef, label: string): SceneField => ({
  on: 'environment',
  key,
  label,
  ...ASSET_SLOT,
});

/**
 * One of the sky's uniforms. `params` is optional: `Sun Disc` is a checkbox,
 * and Tweakpane builds one from the value's type with nothing else to say.
 */
const skyField = (
  key: keyof SkySettings,
  label: string,
  params?: BindingParams,
): SceneField => ({ on: 'sky', key, label, params });

/**
 * What the Inspector shows when nothing is selected — Blender's Scene tab.
 *
 * The panel was a dead space saying "Select an object", and every one of these
 * properties already had a schema, a default, a dirty flag and a binder path.
 * All that was missing was somewhere to type them.
 */
export const SCENE_SCHEMA: readonly SceneSection[] = [
  {
    label: 'Scene',
    // The scene's *address*, not `SceneDoc.name`: writing it moves the file,
    // because the file name is the name. See ADR-14, and the `on: 'scene'`
    // branch in `buildInspector`.
    fields: [{ on: 'scene', key: 'name', label: 'Name' }],
  },
  {
    label: 'Background',
    fields: [
      {
        on: 'environment',
        key: 'backgroundMode',
        label: 'Mode',
        params: { options: { Colour: 'color', Texture: 'texture', Sky: 'sky' } },
      },
      {
        on: 'environment',
        key: 'background',
        label: 'Colour',
        visibleWhen: (scene) => scene.environment.backgroundMode === 'color',
      },
      { ...environmentSlot('backgroundTexture', 'Texture'), visibleWhen: showsTexture },
      {
        on: 'environment',
        key: 'backgroundIntensity',
        label: 'Intensity',
        params: { min: 0, max: 5, step: 0.01 },
        visibleWhen: showsImageBackground,
      },
      {
        on: 'environment',
        key: 'backgroundBlur',
        label: 'Blur',
        // Only the sky, never the reflections — which is the point of having
        // it: a blurred backdrop behind sharp reflections is how a subject is
        // put in front of an environment without it reading as a photograph.
        params: { min: 0, max: 1, step: 0.01 },
        // Texture only, and it loses nothing. Blurring softens a photographed
        // room behind a subject; an analytic sky is already smooth, has no
        // detail to lose, and as a mesh has no mip chain to sample.
        visibleWhen: showsTexture,
      },
    ],
  },
  {
    label: 'Environment',
    fields: [
      {
        on: 'environment',
        key: 'environmentMode',
        label: 'Source',
        params: { options: { None: 'none', Background: 'background', Texture: 'texture' } },
      },
      {
        ...environmentSlot('environmentTexture', 'Lighting'),
        visibleWhen: (scene) => scene.environment.environmentMode === 'texture',
      },
      {
        on: 'environment',
        key: 'environmentIntensity',
        label: 'Intensity',
        params: { min: 0, max: 5, step: 0.01 },
        visibleWhen: (scene) => scene.environment.environmentMode !== 'none',
      },
      {
        on: 'environment',
        key: 'rotation',
        label: 'Rotation',
        // Turns the sky and the light it casts together — see `EnvironmentDef`.
        // Degrees in the panel, radians in the document, like every other
        // rotation the Inspector shows.
        ...asDegrees,
        params: { min: -180, max: 180, step: 1 },
        visibleWhen: turnsAnImage,
      },
    ],
  },
  {
    label: 'Sky',
    // The analytic sky is authored where it is shown. It stays in the document
    // when the mode moves off it, like the background colour and the texture —
    // switching away must not lose what was set up.
    visibleWhen: (scene) => scene.environment.backgroundMode === 'sky',
    fields: [
      skyField('elevation', 'Sun Height', { min: -10, max: 90, step: 0.1 }),
      skyField('azimuth', 'Sun Angle', { min: -180, max: 180, step: 1 }),
      skyField('turbidity', 'Haze', { min: 0, max: 20, step: 0.1 }),
      skyField('rayleigh', 'Blue', { min: 0, max: 4, step: 0.01 }),
      skyField('mieCoefficient', 'Sun Glow', { min: 0, max: 0.1, step: 0.001 }),
      skyField('mieDirectionalG', 'Glow Focus', { min: 0, max: 1, step: 0.01 }),
      // The sky as seen only. The capture that lights the scene never carries
      // the disc, whatever this says — see `ProceduralSky.radiance`.
      skyField('sunDisc', 'Sun Disc'),
      skyField('cloudCoverage', 'Cloud Cover', { min: 0, max: 1, step: 0.01 }),
      skyField('cloudDensity', 'Cloud Density', { min: 0, max: 1, step: 0.01 }),
      skyField('cloudScale', 'Cloud Scale', { min: 0.00001, max: 0.001, step: 0.00001 }),
      skyField('cloudElevation', 'Cloud Height', { min: 0, max: 1, step: 0.01 }),
      // Authored, and inert until three fixes `SkyMesh`: its `time` uniform is
      // never updated, so the clouds hold still at any speed. Not a fault of
      // this application — a plain TSL material animates fine beside it. See
      // `docs/three-skymesh-clouds/`.
      skyField('cloudSpeed', 'Cloud Drift', { min: 0, max: 0.001, step: 0.00001 }),
    ],
  },
  {
    label: 'Fog',
    fields: [
      { on: 'environment', key: 'fogEnabled', label: 'Enabled' },
      { on: 'environment', key: 'fogColor', label: 'Colour', visibleWhen: isFogOn },
      {
        on: 'environment',
        key: 'fogMode',
        label: 'Mode',
        params: { options: { Linear: 'linear', Exponential: 'exponential' } },
        visibleWhen: isFogOn,
      },
      {
        on: 'environment',
        key: 'fogNear',
        label: 'Start',
        params: { min: 0, step: 1 },
        visibleWhen: (scene) => isFogOn(scene) && scene.environment.fogMode === 'linear',
      },
      {
        on: 'environment',
        key: 'fogFar',
        label: 'End',
        params: { min: 0, step: 1 },
        visibleWhen: (scene) => isFogOn(scene) && scene.environment.fogMode === 'linear',
      },
      {
        on: 'environment',
        key: 'fogDensity',
        label: 'Density',
        // Exponential in effect as well as in name: 0.05 already closes the
        // horizon at about forty units.
        params: { min: 0, max: 0.2, step: 0.001 },
        visibleWhen: (scene) => isFogOn(scene) && scene.environment.fogMode === 'exponential',
      },
    ],
  },
];

/**
 * Every predicate the scene pane consults, flattened once, in the order
 * `buildScene` walks them.
 *
 * A section carries a predicate of its own — a folder whose fields are all
 * hidden still draws its header — so it takes a bit alongside its fields rather
 * than being a container the signature cannot see. That is the bit the
 * hand-written version never had.
 */
const SCENE_ENTRIES: readonly { visibleWhen?: (scene: SceneSubject) => boolean }[] =
  SCENE_SCHEMA.flatMap((section) => [section, ...section.fields]);

/**
 * Shape of the scene pane. Rebuilt when this changes; refreshed when it does
 * not — the same contract as `inspectorSignature` for an entity.
 *
 * It used to list by hand the four environment fields a predicate reads, which
 * is a copy of the declaration below it, kept in step by hope. It had already
 * fallen out of step: `section.visibleWhen` was not in it at all, though
 * `buildScene` has always honoured it, so choosing Sky left the Sky folder off
 * screen until something unrelated rebuilt the pane.
 *
 * Takes the environment rather than the whole document on purpose — see
 * `SceneSubject`, which is what keeps that honest.
 */
export function sceneSignature(environment: EnvironmentDef): string {
  return shapeOf(SCENE_ENTRIES, { environment });
}

/**
 * The rows a component's pane would offer, and the identity of that list.
 *
 * Two entries are not fixed by the component's type. A mesh's geometry slot
 * expands into the fields of whichever primitive it is, and a script's declared
 * properties are whatever its source says today — so for those two the *list*
 * changes, not merely which of a fixed list is visible, and no arrangement of
 * bits could say so. That is what `key` is for; everything else about the shape
 * is `visibleWhen`, and `shapeOf` reads it.
 */
export function paneEntriesFor(component: ComponentDoc): {
  key: string;
  entries: readonly Exclude<PaneEntry, GeometrySlotSpec>[];
} {
  // The geometry slot expands in place, so a component that never declares one
  // — every component except `mesh` — is unaffected.
  const entries: Exclude<PaneEntry, GeometrySlotSpec>[] = COMPONENT_SCHEMAS[
    component.type
  ].fields.flatMap((entry) => (isGeometrySlot(entry) ? [...geometryFields(component)] : [entry]));
  entries.push(...scriptFields(component));

  const key =
    component.type === 'mesh'
      ? `mesh:${component.geometry.kind}`
      : component.type === 'script'
        ? `script:${component.assetId}`
        : component.type;

  return { key, entries };
}

/** Geometry fields depend on the primitive, so they are looked up separately. */
export function geometryFields(component: ComponentDoc): readonly FieldSpec[] {
  if (component.type !== 'mesh') return [];
  return GEOMETRY_FIELDS[component.geometry.kind];
}

/**
 * Turns a script's declared properties into inspector fields.
 *
 * This is the feature that makes scripting usable by anyone but its author: a
 * value declared in the script becomes an editable field, saved per instance
 * with the scene. Unity's `[SerializeField]` and Unreal's `UPROPERTY` exist for
 * exactly this, and both engines would be unusable without it.
 */
export function scriptFields(component: ComponentDoc): readonly FieldSpec[] {
  if (component.type !== 'script' || component.assetId === '') return [];

  const declared = useScriptStore.getState().propertiesFor(component.assetId);

  return Object.entries(declared).map(([key, def]): FieldSpec => {
    const path = ['props', key];
    const label = def.label ?? key;
    // An unset property shows the value the script declared, so the panel and
    // the running script agree without having to write defaults into the scene.
    const fallback = 'default' in def ? def.default : undefined;
    // Coerced to the declared type, not passed through: a value saved by an
    // older version of the script (a string where a number is now declared)
    // would otherwise make Tweakpane build a text box instead of a slider.
    const toModel = (value: unknown) => {
      const raw = value ?? fallback;
      if (def.type === 'number') {
        const asNumber = typeof raw === 'number' ? raw : Number(raw);
        return Number.isFinite(asNumber) ? asNumber : (def.default ?? 0);
      }
      if (def.type === 'boolean') return typeof raw === 'boolean' ? raw : Boolean(raw);
      return raw;
    };

    switch (def.type) {
      case 'number':
        return {
          path,
          label,
          toModel,
          params: {
            ...(def.min === undefined ? {} : { min: def.min }),
            ...(def.max === undefined ? {} : { max: def.max }),
            ...(def.step === undefined ? {} : { step: def.step }),
          },
        };
      case 'enum':
        return {
          path,
          label,
          toModel: (value) => value ?? def.default ?? def.options[0],
          params: { options: Object.fromEntries(def.options.map((option) => [option, option])) },
        };
      case 'vec3':
        return {
          path,
          label,
          // Stored as a tuple in the document; Tweakpane wants an xyz object.
          toModel: (value) => {
            const v = (value ?? def.default ?? [0, 0, 0]) as [number, number, number];
            return { x: v[0], y: v[1], z: v[2] };
          },
          fromModel: (value) => {
            const v = value as { x: number; y: number; z: number };
            return [v.x, v.y, v.z];
          },
        };
      case 'entity':
        return {
          path,
          label,
          toModel: (value) => value ?? '',
          optionsProvider: () => {
            const scene = useDocumentStore.getState().scene;
            return {
              None: '',
              ...Object.fromEntries(
                Object.values(scene.entities).map((entity) => [entity.name, entity.id]),
              ),
            };
          },
        };
      case 'asset':
        return {
          path,
          label,
          toModel: (value) => value ?? '',
          optionsProvider: () => {
            const assets = useAssetStore.getState().manifest.assets;
            const matching = def.kind
              ? assets.filter((asset) => asset.kind === def.kind)
              : assets;
            return {
              None: '',
              ...Object.fromEntries(matching.map((asset) => [asset.name, asset.id])),
            };
          },
        };
      case 'boolean':
        return { path, label, toModel: (value) => value ?? def.default ?? false };
      case 'string':
      case 'color':
        return { path, label, toModel: (value) => value ?? def.default ?? '' };
    }
  });
}

