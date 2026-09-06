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
import type {
  AssetKind,
  ComponentDoc,
  FieldDef,
  FieldOption,
  GeometryKind,
} from '@three-studio/core';

/**
 * `Omit` that survives a union.
 *
 * The plain one collapses `A | B` to the keys they share, which for a field
 * would silently drop `min` from every row that has one. Needed here because
 * `FieldSpec` became a union the day the control was declared rather than
 * handed to Tweakpane as a bag of parameters.
 */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * What the control is, when the value alone cannot say it.
 *
 * Tweakpane reads the bound value and builds the obvious control for it — a
 * checkbox for a boolean, a colour picker for `#rrggbb`, a number field for a
 * number. A row says nothing until it has something to add: a range, a list of
 * choices, the fact that a tuple should be edited as a pad. So `type` is
 * absent on most rows, and where it is present it comes with the parameters
 * that only make sense for it.
 *
 * The variants are `core`'s, which is the whole point: an importer, a script
 * and a component pane say "a number between 0 and 1" in the same words, and
 * none of them names Tweakpane to do it.
 */
export type Declared = FieldDef | { type?: undefined };

/**
 * `A | B` intersected with the editor's own half, one member at a time.
 *
 * Written through a type parameter because that is the only way a conditional
 * type distributes: `(A | B) & X` left as an intersection makes `Omit` and
 * excess-property checking read the *shared* keys, which is a `FieldSpec` with
 * no `min` on it anywhere.
 */
type EachWith<D, E> = D extends unknown ? D & E : never;

/**
 * The one control this vocabulary does not describe.
 *
 * `assetField.ts` is a hand-written Tweakpane plugin — thumbnail, drop target,
 * import button — and it is claimed by these parameters rather than by a
 * declared variant. `FieldDef` does have an `asset` variant, but it means the
 * plain dropdown a script property gets today; the two are one idea with two
 * controls, and making them one is a change to what a designer sees rather
 * than to how a pane is written. See `docs/chantier`.
 */
export interface AssetSlotParams {
  view: 'asset';
  assetKind: AssetKind;
  /**
   * What the empty value is called, where "None" would be a lie.
   *
   * A mesh with no material asset draws its own embedded one; a model with none
   * draws the materials its file shipped with. Both are a *choice* rather than
   * an absence, and calling either "None" reads as "this object has no
   * material", which is the opposite of what is on screen.
   */
  emptyLabel?: string;
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
export type FieldSpec<Subject = ComponentDoc> = EachWith<Declared, FieldPlacement<Subject>>;

/** The half of a field only the editor can carry: where it lives, and closures. */
interface FieldPlacement<Subject> {
  /** Path inside the subject, e.g. `['material', 'roughness']`. */
  path: readonly string[];
  label: string;
  /** The asset slot, and nothing else; see `AssetSlotParams`. */
  params?: AssetSlotParams;
  /**
   * Options computed when the pane is built, for choices that depend on the
   * project — the scripts that exist, the entities in the scene, the textures
   * that have been imported. A declared `enum` covers the fixed case.
   */
  optionsProvider?: () => Record<string, string>;
  /** Shown only when this returns true; used for kind-specific light options. */
  visibleWhen?: (subject: Subject) => boolean;
  /** Document value -> value bound by Tweakpane. Overrides the variant's own. */
  toModel?: (value: unknown) => unknown;
  /** Value bound by Tweakpane -> document value. Overrides the variant's own. */
  fromModel?: (value: unknown) => unknown;
}

/** A field as the builder binds it, once `visibleWhen` has already been settled. */
export type BoundSpec = DistributiveOmit<FieldSpec<unknown>, 'visibleWhen'>;

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

/**
 * Whether an entry is a field, by the one property only a field has.
 *
 * `kind` cannot answer it any more: `{ type: 'asset', kind: 'audio' }` is a
 * declared field whose `kind` names an asset kind, so the three guards below
 * would be reading a word that means something else in that row. `path` is
 * what a field is — it is where the value lives — and nothing that is not a
 * field has one.
 */
function isField(entry: PaneEntry): entry is FieldSpec {
  return 'path' in entry;
}

export function isAction(entry: PaneEntry): entry is ActionSpec {
  return !isField(entry) && entry.kind === 'action';
}

export function isGeometrySlot(entry: PaneEntry): entry is GeometrySlotSpec {
  return !isField(entry) && entry.kind === 'geometry';
}

export function isSeparator(entry: PaneEntry): entry is SeparatorSpec {
  return !isField(entry) && entry.kind === 'separator';
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

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

/**
 * Angles are stored in radians and always shown in degrees.
 *
 * A converter pair rather than a declared variant, and the line is worth
 * knowing: a tuple bound as a pad *must* be converted, so `vec2` and `vec3`
 * carry their own conversion, but showing an angle in degrees is a choice —
 * `particleEmitter.velocity` is three numbers that are not an angle at all.
 */
export const asDegrees: Pick<FieldSpec, 'toModel' | 'fromModel'> = {
  toModel: (value) => (value as number) * RAD_TO_DEG,
  fromModel: (value) => (value as number) * DEG_TO_RAD,
};

/** The `MaterialSide` union, as a list of choices. Two panes bind it. */
export const SIDE_OPTIONS: readonly FieldOption[] = [
  { value: 'front', label: 'Front' },
  { value: 'back', label: 'Back' },
  { value: 'double', label: 'Double' },
];

/**
 * Keyed by `GeometryKind`, so adding a primitive to the union without giving it
 * inspector fields is a compile error rather than an empty panel.
 */
export const GEOMETRY_FIELDS: Record<GeometryKind, readonly FieldSpec[]> = {
  box: [
    { path: ['geometry', 'width'], label: 'Width', type: 'number', min: 0.01, step: 0.1 },
    { path: ['geometry', 'height'], label: 'Height', type: 'number', min: 0.01, step: 0.1 },
    { path: ['geometry', 'depth'], label: 'Depth', type: 'number', min: 0.01, step: 0.1 },
    // Displacement moves vertices, so a one-segment face cannot show any of it.
    {
      path: ['geometry', 'widthSegments'],
      label: 'Segments X',
      type: 'number', min: 1, max: 256, step: 1,
    },
    {
      path: ['geometry', 'heightSegments'],
      label: 'Segments Y',
      type: 'number', min: 1, max: 256, step: 1,
    },
    {
      path: ['geometry', 'depthSegments'],
      label: 'Segments Z',
      type: 'number', min: 1, max: 256, step: 1,
    },
  ],
  sphere: [
    { path: ['geometry', 'radius'], label: 'Radius', type: 'number', min: 0.01, step: 0.1 },
    {
      path: ['geometry', 'widthSegments'],
      label: 'Segments U',
      type: 'number', min: 3, max: 128, step: 1,
    },
    {
      path: ['geometry', 'heightSegments'],
      label: 'Segments V',
      type: 'number', min: 2, max: 64, step: 1,
    },
  ],
  plane: [
    { path: ['geometry', 'width'], label: 'Width', type: 'number', min: 0.01, step: 0.5 },
    { path: ['geometry', 'height'], label: 'Height', type: 'number', min: 0.01, step: 0.5 },
    {
      path: ['geometry', 'widthSegments'],
      label: 'Segments X',
      type: 'number', min: 1, max: 512, step: 1,
    },
    {
      path: ['geometry', 'heightSegments'],
      label: 'Segments Y',
      type: 'number', min: 1, max: 512, step: 1,
    },
  ],
  capsule: [
    { path: ['geometry', 'radius'], label: 'Radius', type: 'number', min: 0.01, step: 0.1 },
    { path: ['geometry', 'height'], label: 'Height', type: 'number', min: 0.01, step: 0.1 },
  ],
  cylinder: [
    { path: ['geometry', 'radiusTop'], label: 'Radius top', type: 'number', min: 0, step: 0.1 },
    {
      path: ['geometry', 'radiusBottom'],
      label: 'Radius bottom',
      type: 'number', min: 0, step: 0.1,
    },
    { path: ['geometry', 'height'], label: 'Height', type: 'number', min: 0.01, step: 0.1 },
  ],
  circle: [
    { path: ['geometry', 'radius'], label: 'Radius', type: 'number', min: 0.01, step: 0.1 },
    {
      path: ['geometry', 'segments'],
      label: 'Segments',
      type: 'number', min: 3, max: 128, step: 1,
    },
  ],
  ring: [
    {
      path: ['geometry', 'innerRadius'],
      label: 'Inner radius',
      type: 'number', min: 0, step: 0.05,
    },
    {
      path: ['geometry', 'outerRadius'],
      label: 'Outer radius',
      type: 'number', min: 0.01, step: 0.05,
    },
    {
      path: ['geometry', 'thetaSegments'],
      label: 'Segments',
      type: 'number', min: 3, max: 128, step: 1,
    },
  ],
  torus: [
    { path: ['geometry', 'radius'], label: 'Radius', type: 'number', min: 0.01, step: 0.05 },
    { path: ['geometry', 'tube'], label: 'Tube', type: 'number', min: 0.01, step: 0.02 },
    {
      path: ['geometry', 'radialSegments'],
      label: 'Segments U',
      type: 'number', min: 3, max: 64, step: 1,
    },
    {
      path: ['geometry', 'tubularSegments'],
      label: 'Segments V',
      type: 'number', min: 3, max: 256, step: 1,
    },
  ],
  torusKnot: [
    { path: ['geometry', 'radius'], label: 'Radius', type: 'number', min: 0.01, step: 0.05 },
    { path: ['geometry', 'tube'], label: 'Tube', type: 'number', min: 0.01, step: 0.02 },
    { path: ['geometry', 'p'], label: 'Winding P', type: 'number', min: 1, max: 20, step: 1 },
    { path: ['geometry', 'q'], label: 'Winding Q', type: 'number', min: 1, max: 20, step: 1 },
    {
      path: ['geometry', 'radialSegments'],
      label: 'Segments U',
      type: 'number', min: 3, max: 64, step: 1,
    },
    {
      path: ['geometry', 'tubularSegments'],
      label: 'Segments V',
      type: 'number', min: 3, max: 512, step: 1,
    },
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
    { path: ['geometry', 'radius'], label: 'Radius', type: 'number', min: 0.01, step: 0.1 },
    {
      path: ['geometry', 'detail'],
      label: 'Subdivisions',
      type: 'number', min: 0, max: 5, step: 1,
    },
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
} satisfies DistributiveOmit<FieldSpec<never>, 'path' | 'label' | 'type'>;

/**
 * One asset slot, for whichever kind of asset it holds.
 *
 * The kind is a parameter rather than four near-identical helpers, and it has
 * a default because two thirds of the slots in the editor are textures. It was
 * texture-only until the panes that needed audio and material slots wrote the
 * Tweakpane parameters out by hand instead — which is exactly the leak this
 * vocabulary exists to stop.
 */
export const assetSlot = <Subject,>(
  path: readonly string[],
  label: string,
  assetKind: AssetKind = 'texture',
  emptyLabel?: string,
): FieldSpec<Subject> => ({
  ...ASSET_SLOT,
  path,
  label,
  params: { view: 'asset', assetKind, ...(emptyLabel === undefined ? {} : { emptyLabel }) },
});

export const textureSlot = (key: string, label: string): FieldSpec =>
  assetSlot(['material', key], label);

export const MATERIAL_FIELDS: readonly FieldSpec[] = [
  { path: ['material', 'color'], label: 'Colour' },
  {
    path: ['material', 'roughness'],
    label: 'Roughness',
    type: 'number', min: 0, max: 1, step: 0.01,
  },
  {
    path: ['material', 'metalness'],
    label: 'Metalness',
    type: 'number', min: 0, max: 1, step: 0.01,
  },
  { path: ['material', 'emissive'], label: 'Emissive' },
  {
    path: ['material', 'emissiveIntensity'],
    label: 'Emissive power',
    type: 'number', min: 0, max: 20, step: 0.1,
  },
  { path: ['material', 'opacity'], label: 'Opacity', type: 'number', min: 0, max: 1, step: 0.01 },
  { path: ['material', 'transparent'], label: 'Transparent' },
  { path: ['material', 'wireframe'], label: 'Wireframe' },
  { path: ['material', 'side'], label: 'Side', type: 'enum', options: SIDE_OPTIONS },

  textureSlot('colorMap', 'Base colour map'),
  textureSlot('normalMap', 'Normal map'),
  {
    path: ['material', 'normalScale'],
    label: 'Normal strength',
    type: 'number', min: 0, max: 4, step: 0.05,
    visibleWhen: (c) => c.type === 'mesh' && c.material.normalMap !== null,
  },
  textureSlot('bumpMap', 'Bump map'),
  {
    path: ['material', 'bumpScale'],
    label: 'Bump strength',
    type: 'number', min: 0, max: 4, step: 0.05,
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
    type: 'number', min: 0, max: 1, step: 0.01,
    visibleWhen: (c) => c.type === 'mesh' && c.material.aoMap !== null,
  },
  textureSlot('alphaMap', 'Alpha map'),
  textureSlot('displacementMap', 'Displacement map'),
  {
    path: ['material', 'displacementScale'],
    label: 'Displacement',
    type: 'number', min: -2, max: 2, step: 0.01,
    visibleWhen: (c) => c.type === 'mesh' && c.material.displacementMap !== null,
  },
  {
    path: ['material', 'displacementBias'],
    label: 'Displacement bias',
    type: 'number', min: -1, max: 1, step: 0.01,
    visibleWhen: (c) => c.type === 'mesh' && c.material.displacementMap !== null,
  },

  // The UV transform belongs to the three `Texture`, but it reads as a property
  // of the material here because it applies to every slot at once.
  { path: ['material', 'tiling'], label: 'Tiling', type: 'vec2', step: 0.1 },
  { path: ['material', 'offset'], label: 'Offset', type: 'vec2', step: 0.01 },
  {
    path: ['material', 'wrap'],
    label: 'Wrap',
    type: 'enum',
    options: [
      { value: 'repeat', label: 'Repeat' },
      { value: 'clamp', label: 'Clamp' },
      { value: 'mirror', label: 'Mirror' },
    ],
  },
];
