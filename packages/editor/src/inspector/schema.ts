import type {
  ComponentDoc,
  ComponentType,
  EnvironmentDef,
  GeometryKind,
  MaterialDef,
  SceneDoc,
  SkySettings,
} from '@three-studio/core';
import type { BindingParams } from 'tweakpane';
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

/**
 * Declarative description of one editable field.
 *
 * Adding a property to a component means adding a line here — the inspector,
 * its undo coalescing and its refresh loop are all generic over this table.
 *
 * @typeParam Subject What `path` is read from and what `visibleWhen` is handed:
 *   a component for the entity panes, the whole `SceneDoc` for the scene one.
 */
export interface FieldSpec<Subject = ComponentDoc> {
  /** Path inside the subject, e.g. `['material', 'roughness']`. */
  path: readonly string[];
  label: string;
  /** Passed straight to Tweakpane: `min`, `max`, `step`, `options`, `view`. */
  params?: BindingParams;
  /**
   * Options computed when the pane is built, for choices that depend on the
   * project — the scripts that exist, the entities in the scene, the textures
   * that have been imported.
   */
  optionsProvider?: () => Record<string, string>;
  /** Shown only when this returns true; used for kind-specific light options. */
  visibleWhen?: (subject: Subject) => boolean;
  /** Document value -> value bound by Tweakpane. */
  toModel?: (value: unknown) => unknown;
  /** Value bound by Tweakpane -> document value. */
  fromModel?: (value: unknown) => unknown;
}

/** A field as the builder binds it, once `visibleWhen` has already been settled. */
export type BoundSpec = Omit<FieldSpec<unknown>, 'visibleWhen'>;

/**
 * A button rather than an editable value. Used where the operation is not
 * "set this property" — extracting a material into an asset, for instance.
 */
export interface ActionSpec {
  kind: 'action';
  /** Button text. */
  title: string;
  /**
   * Label column text. Empty by default, which still puts the button in the
   * value column rather than across the whole row — a full-width button reads
   * as belonging to the component, not to the field above it.
   */
  label?: string;
  visibleWhen?: (component: ComponentDoc) => boolean;
  run: (context: { entityId: string; componentId: string; component: ComponentDoc }) => void;
}

/**
 * Where the primitive's own fields go.
 *
 * They used to be appended after everything else, which put "Segments X" below
 * twenty-odd material rows — present, and effectively unfindable. Declaring the
 * position here keeps ordering a property of the schema rather than of the
 * builder.
 */
export interface GeometrySlotSpec {
  kind: 'geometry';
}

/** A rule, to show where one group of fields ends and the next begins. */
export interface SeparatorSpec {
  kind: 'separator';
}

export type PaneEntry = FieldSpec | ActionSpec | GeometrySlotSpec | SeparatorSpec;

export function isAction(entry: PaneEntry): entry is ActionSpec {
  return 'kind' in entry && entry.kind === 'action';
}

export function isGeometrySlot(entry: PaneEntry): entry is GeometrySlotSpec {
  return 'kind' in entry && entry.kind === 'geometry';
}

export function isSeparator(entry: PaneEntry): entry is SeparatorSpec {
  return 'kind' in entry && entry.kind === 'separator';
}

export interface ComponentSchema {
  label: string;
  fields: readonly PaneEntry[];
}

/** Tweakpane's 2D pad binds `{x, y}`; the document stores a tuple. */
const asVec2: Pick<FieldSpec, 'toModel' | 'fromModel'> = {
  toModel: (value) => {
    const [x, y] = value as [number, number];
    return { x, y };
  },
  fromModel: (value) => {
    const { x, y } = value as { x: number; y: number };
    return [x, y];
  },
};

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

/** Angles are stored in radians and always shown in degrees. */
const asDegrees: Pick<FieldSpec, 'toModel' | 'fromModel'> = {
  toModel: (value) => (value as number) * RAD_TO_DEG,
  fromModel: (value) => (value as number) * DEG_TO_RAD,
};

const isLightKind =
  (...kinds: readonly string[]) =>
  (component: ComponentDoc) =>
    component.type === 'light' && kinds.includes(component.kind);

/**
 * A shadow setting is worth showing only on a light that casts one.
 *
 * With no kinds given it means every kind that can: the shadow object exists on
 * all of them, so the checkbox is the whole condition. Naming kinds narrows it
 * further, for the settings that live on one class of shadow camera — a
 * directional light's is a box and a spot's is a frustum.
 */
const casts =
  (...kinds: readonly string[]) =>
  (component: ComponentDoc) =>
    component.type === 'light' &&
    component.castShadow &&
    (kinds.length === 0 || kinds.includes(component.kind));

/** 3D falloff only matters once a source has some spatial blend. */
const isPositional = (component: ComponentDoc) =>
  component.type === 'audioSource' && component.spatialBlend > 0;

/**
 * Keyed by `GeometryKind`, so adding a primitive to the union without giving it
 * inspector fields is a compile error rather than an empty panel.
 */
const GEOMETRY_FIELDS: Record<GeometryKind, readonly FieldSpec[]> = {
  box: [
    { path: ['geometry', 'width'], label: 'Width', params: { min: 0.01, step: 0.1 } },
    { path: ['geometry', 'height'], label: 'Height', params: { min: 0.01, step: 0.1 } },
    { path: ['geometry', 'depth'], label: 'Depth', params: { min: 0.01, step: 0.1 } },
    // Displacement moves vertices, so a one-segment face cannot show any of it.
    { path: ['geometry', 'widthSegments'], label: 'Segments X', params: { min: 1, max: 256, step: 1 } },
    { path: ['geometry', 'heightSegments'], label: 'Segments Y', params: { min: 1, max: 256, step: 1 } },
    { path: ['geometry', 'depthSegments'], label: 'Segments Z', params: { min: 1, max: 256, step: 1 } },
  ],
  sphere: [
    { path: ['geometry', 'radius'], label: 'Radius', params: { min: 0.01, step: 0.1 } },
    { path: ['geometry', 'widthSegments'], label: 'Segments U', params: { min: 3, max: 128, step: 1 } },
    { path: ['geometry', 'heightSegments'], label: 'Segments V', params: { min: 2, max: 64, step: 1 } },
  ],
  plane: [
    { path: ['geometry', 'width'], label: 'Width', params: { min: 0.01, step: 0.5 } },
    { path: ['geometry', 'height'], label: 'Height', params: { min: 0.01, step: 0.5 } },
    { path: ['geometry', 'widthSegments'], label: 'Segments X', params: { min: 1, max: 512, step: 1 } },
    { path: ['geometry', 'heightSegments'], label: 'Segments Y', params: { min: 1, max: 512, step: 1 } },
  ],
  capsule: [
    { path: ['geometry', 'radius'], label: 'Radius', params: { min: 0.01, step: 0.1 } },
    { path: ['geometry', 'height'], label: 'Height', params: { min: 0.01, step: 0.1 } },
  ],
  cylinder: [
    { path: ['geometry', 'radiusTop'], label: 'Radius top', params: { min: 0, step: 0.1 } },
    { path: ['geometry', 'radiusBottom'], label: 'Radius bottom', params: { min: 0, step: 0.1 } },
    { path: ['geometry', 'height'], label: 'Height', params: { min: 0.01, step: 0.1 } },
  ],
  circle: [
    { path: ['geometry', 'radius'], label: 'Radius', params: { min: 0.01, step: 0.1 } },
    { path: ['geometry', 'segments'], label: 'Segments', params: { min: 3, max: 128, step: 1 } },
  ],
  ring: [
    { path: ['geometry', 'innerRadius'], label: 'Inner radius', params: { min: 0, step: 0.05 } },
    { path: ['geometry', 'outerRadius'], label: 'Outer radius', params: { min: 0.01, step: 0.05 } },
    { path: ['geometry', 'thetaSegments'], label: 'Segments', params: { min: 3, max: 128, step: 1 } },
  ],
  torus: [
    { path: ['geometry', 'radius'], label: 'Radius', params: { min: 0.01, step: 0.05 } },
    { path: ['geometry', 'tube'], label: 'Tube', params: { min: 0.01, step: 0.02 } },
    { path: ['geometry', 'radialSegments'], label: 'Segments U', params: { min: 3, max: 64, step: 1 } },
    { path: ['geometry', 'tubularSegments'], label: 'Segments V', params: { min: 3, max: 256, step: 1 } },
  ],
  torusKnot: [
    { path: ['geometry', 'radius'], label: 'Radius', params: { min: 0.01, step: 0.05 } },
    { path: ['geometry', 'tube'], label: 'Tube', params: { min: 0.01, step: 0.02 } },
    { path: ['geometry', 'p'], label: 'Winding P', params: { min: 1, max: 20, step: 1 } },
    { path: ['geometry', 'q'], label: 'Winding Q', params: { min: 1, max: 20, step: 1 } },
    { path: ['geometry', 'radialSegments'], label: 'Segments U', params: { min: 3, max: 64, step: 1 } },
    { path: ['geometry', 'tubularSegments'], label: 'Segments V', params: { min: 3, max: 512, step: 1 } },
  ],
  ...polyhedronFields('tetrahedron', 'octahedron', 'dodecahedron', 'icosahedron'),
};

/**
 * The four solids take the same two arguments in three, so they take the same
 * two fields here. `detail` is capped low on purpose: it is exponential, and 5
 * already puts a single solid past a hundred thousand triangles.
 */
function polyhedronFields<K extends GeometryKind>(
  ...kinds: readonly K[]
): Record<K, readonly FieldSpec[]> {
  const fields: readonly FieldSpec[] = [
    { path: ['geometry', 'radius'], label: 'Radius', params: { min: 0.01, step: 0.1 } },
    { path: ['geometry', 'detail'], label: 'Subdivisions', params: { min: 0, max: 5, step: 1 } },
  ];
  return Object.fromEntries(kinds.map((kind) => [kind, fields])) as Record<K, readonly FieldSpec[]>;
}

/**
 * A slot stores `null` when empty, but the control needs a primitive, so the
 * empty choice round-trips through `''`.
 *
 * `view: 'asset'` picks our own control (`assetField.ts`): a thumbnail, the
 * textures already imported, and a picker that imports into the project before
 * assigning.
 */
/**
 * What makes a field an asset picker, with no opinion on where it lives.
 *
 * Separate from `assetSlot` because the scene pane addresses its fields by
 * block and key rather than by path, and these three properties are the whole
 * of what the two have in common.
 */
const ASSET_SLOT = {
  params: { view: 'asset', assetKind: 'texture' },
  toModel: (value: unknown) => value ?? '',
  fromModel: (value: unknown) => (value === '' ? null : value),
} satisfies Omit<FieldSpec<never>, 'path' | 'label'>;

const assetSlot = <Subject,>(
  path: readonly string[],
  label: string,
): FieldSpec<Subject> => ({ path, label, ...ASSET_SLOT });

const textureSlot = (key: string, label: string): FieldSpec =>
  assetSlot(['material', key], label);

const MATERIAL_FIELDS: readonly FieldSpec[] = [
  { path: ['material', 'color'], label: 'Colour' },
  { path: ['material', 'roughness'], label: 'Roughness', params: { min: 0, max: 1, step: 0.01 } },
  { path: ['material', 'metalness'], label: 'Metalness', params: { min: 0, max: 1, step: 0.01 } },
  { path: ['material', 'emissive'], label: 'Emissive' },
  {
    path: ['material', 'emissiveIntensity'],
    label: 'Emissive power',
    params: { min: 0, max: 20, step: 0.1 },
  },
  { path: ['material', 'opacity'], label: 'Opacity', params: { min: 0, max: 1, step: 0.01 } },
  { path: ['material', 'transparent'], label: 'Transparent' },
  { path: ['material', 'wireframe'], label: 'Wireframe' },
  {
    path: ['material', 'side'],
    label: 'Side',
    params: { options: { Front: 'front', Back: 'back', Double: 'double' } },
  },

  textureSlot('colorMap', 'Base colour map'),
  textureSlot('normalMap', 'Normal map'),
  {
    path: ['material', 'normalScale'],
    label: 'Normal strength',
    params: { min: 0, max: 4, step: 0.05 },
    visibleWhen: (c) => c.type === 'mesh' && c.material.normalMap !== null,
  },
  textureSlot('bumpMap', 'Bump map'),
  {
    path: ['material', 'bumpScale'],
    label: 'Bump strength',
    params: { min: 0, max: 4, step: 0.05 },
    // Tied to the bump slot alone. It has no effect while a normal map is also
    // set — three picks one — but hiding the strength of a map that is visibly
    // assigned would read as the field being broken.
    visibleWhen: (c) => c.type === 'mesh' && c.material.bumpMap !== null,
  },
  textureSlot('roughnessMap', 'Roughness map'),
  textureSlot('metalnessMap', 'Metalness map'),
  textureSlot('emissiveMap', 'Emissive map'),
  textureSlot('aoMap', 'Occlusion map'),
  {
    path: ['material', 'aoIntensity'],
    label: 'Occlusion strength',
    params: { min: 0, max: 1, step: 0.01 },
    visibleWhen: (c) => c.type === 'mesh' && c.material.aoMap !== null,
  },
  textureSlot('alphaMap', 'Alpha map'),
  textureSlot('displacementMap', 'Displacement map'),
  {
    path: ['material', 'displacementScale'],
    label: 'Displacement',
    params: { min: -2, max: 2, step: 0.01 },
    visibleWhen: (c) => c.type === 'mesh' && c.material.displacementMap !== null,
  },
  {
    path: ['material', 'displacementBias'],
    label: 'Displacement bias',
    params: { min: -1, max: 1, step: 0.01 },
    visibleWhen: (c) => c.type === 'mesh' && c.material.displacementMap !== null,
  },

  // The UV transform belongs to the three `Texture`, but it reads as a property
  // of the material here because it applies to every slot at once.
  {
    path: ['material', 'tiling'],
    label: 'Tiling',
    params: { x: { step: 0.1 }, y: { step: 0.1 } },
    ...asVec2,
  },
  {
    path: ['material', 'offset'],
    label: 'Offset',
    params: { x: { step: 0.01 }, y: { step: 0.01 } },
    ...asVec2,
  },
  {
    path: ['material', 'wrap'],
    label: 'Wrap',
    params: { options: { Repeat: 'repeat', Clamp: 'clamp', Mirror: 'mirror' } },
  },
];

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
  light: {
    label: 'Light',
    fields: [
      { path: ['color'], label: 'Colour' },
      { path: ['intensity'], label: 'Intensity', params: { min: 0, max: 50, step: 0.1 } },
      {
        path: ['groundColor'],
        label: 'Ground colour',
        visibleWhen: isLightKind('hemisphere'),
      },
      {
        path: ['distance'],
        label: 'Range',
        params: { min: 0, max: 200, step: 0.5 },
        visibleWhen: isLightKind('point', 'spot', 'projector'),
      },
      {
        path: ['decay'],
        label: 'Decay',
        params: { min: 0, max: 4, step: 0.1 },
        visibleWhen: isLightKind('point', 'spot', 'projector'),
      },
      {
        path: ['angle'],
        label: 'Cone angle',
        params: { min: 1, max: 89, step: 1 },
        visibleWhen: isLightKind('spot', 'projector'),
        ...asDegrees,
      },
      {
        path: ['penumbra'],
        label: 'Penumbra',
        params: { min: 0, max: 1, step: 0.01 },
        visibleWhen: isLightKind('spot', 'projector'),
      },
      {
        path: ['width'],
        label: 'Width',
        params: { min: 0.01, max: 50, step: 0.05 },
        visibleWhen: isLightKind('rectArea'),
      },
      {
        path: ['height'],
        label: 'Height',
        params: { min: 0.01, max: 50, step: 0.05 },
        visibleWhen: isLightKind('rectArea'),
      },
      {
        ...assetSlot(['mapId'], 'Cookie'),
        visibleWhen: isLightKind('projector'),
      },
      {
        path: ['aspect'],
        // `0` is the useful default and means "take it from the texture", the
        // same convention `distance: 0` uses for an unbounded range.
        label: 'Aspect (0 = image)',
        params: { min: 0, max: 4, step: 0.01 },
        visibleWhen: isLightKind('projector'),
      },
      {
        path: ['castShadow'],
        label: 'Cast shadows',
        // Not `rectArea`: three shades it with linearly transformed cosines and
        // has no shadow path for it at all, so the checkbox would be a lie.
        visibleWhen: isLightKind('directional', 'point', 'spot', 'projector'),
      },
      /*
       * Everything below is `light.shadow`, and is shown only once the light
       * actually casts one.
       *
       * `inspectorSignature` carries `castShadow` for this reason: these fields
       * appear and disappear with the checkbox above, and a signature that
       * tracked only the kind would refresh the pane's values without rebuilding
       * its rows — the checkbox would tick and nothing else would happen.
       */
      { kind: 'separator' },
      {
        path: ['shadow', 'bias'],
        // The one an author reaches for first, and the one whose useful range is
        // nothing like its slider's: acne goes at about -0.0005.
        label: 'Bias',
        params: { min: -0.01, max: 0.01, step: 0.0001 },
        visibleWhen: casts(),
      },
      {
        path: ['shadow', 'normalBias'],
        label: 'Normal bias',
        params: { min: 0, max: 0.5, step: 0.001 },
        visibleWhen: casts(),
      },
      {
        path: ['shadow', 'radius'],
        label: 'Softness',
        params: { min: 0, max: 25, step: 0.5 },
        visibleWhen: casts(),
      },
      {
        path: ['shadow', 'blurSamples'],
        label: 'Blur samples',
        params: { min: 1, max: 32, step: 1 },
        visibleWhen: casts(),
      },
      {
        path: ['shadow', 'near'],
        label: 'Shadow near',
        params: { min: 0.001, max: 10, step: 0.01 },
        visibleWhen: casts(),
      },
      {
        path: ['shadow', 'far'],
        label: 'Shadow far',
        params: { min: 1, max: 2000, step: 10 },
        visibleWhen: casts(),
      },
      {
        path: ['shadow', 'orthoSize'],
        // The half-extent of the box the sun casts from. Too small and distant
        // objects stop casting entirely; too large and the same map is spread
        // thinner, which reads as shadows going soft and blocky at once.
        label: 'Shadow area',
        params: { min: 1, max: 200, step: 1 },
        visibleWhen: casts('directional'),
      },
      {
        path: ['shadow', 'focus'],
        label: 'Shadow focus',
        params: { min: 0.1, max: 4, step: 0.05 },
        visibleWhen: casts('spot', 'projector'),
      },
    ],
  },
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
  audioListener: {
    label: 'Audio Listener',
    fields: [{ path: ['masterVolume'], label: 'Master volume', params: { min: 0, max: 1, step: 0.01 } }],
  },
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
type SceneFieldBase = Omit<FieldSpec<SceneDoc>, 'path'>;

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
  visibleWhen?: (scene: SceneDoc) => boolean;
  fields: readonly SceneField[];
}

const isFogOn = (scene: SceneDoc) => scene.environment.fogEnabled;
const showsTexture = (scene: SceneDoc) => scene.environment.backgroundMode === 'texture';

/**
 * The background is an image, whatever it is an image of.
 *
 * Its intensity applies to both: a photograph goes through
 * `scene.backgroundIntensity`, and the analytic sky — which is a mesh, so
 * `scene.background` is null — through a uniform on its own material. See
 * `ProceduralSky`.
 */
const showsImageBackground = (scene: SceneDoc) => scene.environment.backgroundMode !== 'color';

/**
 * Something the shared rotation actually turns.
 *
 * Not the analytic sky: it is turned by its own `azimuth`, which moves the sun
 * with it. Offering a second angle that spins the whole capture underneath the
 * first is two controls fighting over one thing.
 */
const turnsAnImage = (scene: SceneDoc) =>
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
    // The scene's *address*, not `SceneDoc.name`: writing it renames the file
    // through the registry, which is where uniqueness lives. See ADR-14, and
    // the `on: 'scene'` branch in `buildInspector`.
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
 * Shape of the scene pane. Rebuilt when this changes; refreshed when it does
 * not — the same contract as `inspectorSignature` for an entity.
 *
 * Takes the environment rather than the whole document on purpose: immer keeps
 * the identity of anything a mutation did not touch, so a panel keyed on this
 * is not recomputed by every unrelated edit in the scene.
 */
export function sceneSignature(environment: EnvironmentDef): string {
  // Every field a `visibleWhen` reads, and only those. Miss one and the rows it
  // governs are decided once and never revisited: choosing Sky would leave the
  // Texture slot on screen and the Sky folder off it until something unrelated
  // rebuilt the pane.
  return [
    'scene',
    environment.backgroundMode,
    environment.environmentMode,
    environment.fogEnabled,
    environment.fogMode,
  ].join(':');
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

