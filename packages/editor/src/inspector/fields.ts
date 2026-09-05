/*
 * The vocabulary a component pane is written in, below the panes themselves.
 *
 * These lived in `schema.ts` beside `COMPONENT_SCHEMAS` until a component type
 * moved into a folder of its own. That is what put them here: a slice is
 * written in this vocabulary, and the index that assembles the panes imports
 * the slices, so the two cannot share a module without every slice becoming an
 * import cycle — one the architecture test would name, and one that would be
 * twelve files wide by the end. The same split, for the same reason, as
 * `core`'s `scene/primitives.ts`.
 *
 * `schema.ts` re-exports all of it, so nothing that builds a pane has to know
 * this file exists.
 */
import type { ComponentDoc, GeometryKind } from '@three-studio/core';
import type { BindingParams } from 'tweakpane';


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
  /**
   * Never conditional, and said out loud rather than left absent.
   *
   * A rule belongs to the layout, not to a row that can come and go: hiding one
   * would leave two groups running together with nothing between them. Declared
   * so that this shares a property with the rest of `PaneEntry`, which is what
   * lets `shapeOf` read a whole list of them without a cast.
   */
  visibleWhen?: never;
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

  /*
   * The three facets below are declared only by the types that have them, the
   * way a runtime system declares a capability. Two panes are not fixed by the
   * component's type: a mesh's geometry slot expands into the fields of
   * whichever primitive it is, and a script's properties are whatever its
   * source says today. For those two the *list* changes, not merely which of a
   * fixed list is visible.
   */

  /** What a `{ kind: 'geometry' }` slot expands into. Declared by `mesh`. */
  geometryFields?(component: ComponentDoc): readonly FieldSpec[];
  /** Rows appended after the declared ones, from the document. Declared by `script`. */
  extraFields?(component: ComponentDoc): readonly FieldSpec[];
  /**
   * What makes this component's row list a *different* list.
   *
   * The type alone, unless the two above can change what the list contains — no
   * arrangement of `visibleWhen` bits could say that, which is what this is for.
   */
  paneKey?(component: ComponentDoc): string;
}

/** Tweakpane's 2D pad binds `{x, y}`; the document stores a tuple. */
export const asVec2: Pick<FieldSpec, 'toModel' | 'fromModel'> = {
  toModel: (value) => {
    const [x, y] = value as [number, number];
    return { x, y };
  },
  fromModel: (value) => {
    const { x, y } = value as { x: number; y: number };
    return [x, y];
  },
};

/** Tweakpane's 3D pad binds `{x, y, z}`; the document stores a tuple. */
export const asVec3: Pick<FieldSpec, 'toModel' | 'fromModel'> = {
  toModel: (value) => {
    const [x, y, z] = value as [number, number, number];
    return { x, y, z };
  },
  fromModel: (value) => {
    const { x, y, z } = value as { x: number; y: number; z: number };
    return [x, y, z];
  },
};

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

/** Angles are stored in radians and always shown in degrees. */
export const asDegrees: Pick<FieldSpec, 'toModel' | 'fromModel'> = {
  toModel: (value) => (value as number) * RAD_TO_DEG,
  fromModel: (value) => (value as number) * DEG_TO_RAD,
};

/** The `MaterialSide` union, as a Tweakpane list. Two panes bind it. */
export const SIDE_OPTIONS = { Front: 'front', Back: 'back', Double: 'double' } as const;

/**
 * Keyed by `GeometryKind`, so adding a primitive to the union without giving it
 * inspector fields is a compile error rather than an empty panel.
 */
export const GEOMETRY_FIELDS: Record<GeometryKind, readonly FieldSpec[]> = {
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
export const ASSET_SLOT = {
  params: { view: 'asset', assetKind: 'texture' },
  toModel: (value: unknown) => value ?? '',
  fromModel: (value: unknown) => (value === '' ? null : value),
} satisfies Omit<FieldSpec<never>, 'path' | 'label'>;

export const assetSlot = <Subject,>(
  path: readonly string[],
  label: string,
): FieldSpec<Subject> => ({ path, label, ...ASSET_SLOT });

export const textureSlot = (key: string, label: string): FieldSpec =>
  assetSlot(['material', key], label);

export const MATERIAL_FIELDS: readonly FieldSpec[] = [
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
  { path: ['material', 'side'], label: 'Side', params: { options: SIDE_OPTIONS } },

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
