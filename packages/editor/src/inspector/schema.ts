import {
  BACKGROUND_MODE_LABELS,
  ENVIRONMENT_MODE_LABELS,
  FOG_MODE_LABELS,
  SUN_CUSTOM,
  optionsFrom,
  type ComponentDoc,
  type ComponentType,
  type EnvironmentDef,
  type MaterialDef,
  type SceneDoc,
  type SkySettings,
} from '@three-studio/core';
import { ASSET_SLOT, asDegrees, type DistributiveOmit, type FieldSpec } from './fields';
import { shapeOf } from './signature';

/*
 * The scene pane, and the door onto the field vocabulary.
 *
 * The twelve component panes left for `components/<type>/inspector.ts`, and
 * `components/panes.ts` assembles them. What stays is what is not per-type: the
 * environment's own pane, and a re-export of `fields.ts` so that nothing which
 * writes a field has to know where the vocabulary lives.
 */
export {
  ASSET_SLOT,
  GEOMETRY_FIELDS,
  MATERIAL_FIELDS,
  asDegrees,
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

type SceneFieldBase = DistributiveOmit<FieldSpec<SceneSubject>, 'path'>;

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
 * One of the sky's uniforms. The range is optional: `Sun Disc` is a checkbox,
 * and Tweakpane builds one from the value's type with nothing else to say.
 */
const skyField = (
  key: keyof SkySettings,
  label: string,
  range?: { min: number; max: number; step: number },
): SceneField =>
  range === undefined
    ? { on: 'sky', key, label }
    : { on: 'sky', key, label, type: 'number', ...range };

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
    // because the file name is the name. See the `on: 'scene'`
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
        type: 'enum',
        options: optionsFrom(BACKGROUND_MODE_LABELS),
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
        type: 'number', min: 0, max: 5, step: 0.01,
        visibleWhen: showsImageBackground,
      },
      {
        on: 'environment',
        key: 'backgroundBlur',
        label: 'Blur',
        // Only the sky, never the reflections — which is the point of having
        // it: a blurred backdrop behind sharp reflections is how a subject is
        // put in front of an environment without it reading as a photograph.
        type: 'number', min: 0, max: 1, step: 0.01,
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
        type: 'enum',
        options: optionsFrom(ENVIRONMENT_MODE_LABELS),
      },
      {
        ...environmentSlot('environmentTexture', 'Lighting'),
        visibleWhen: (scene) => scene.environment.environmentMode === 'texture',
      },
      {
        on: 'environment',
        key: 'environmentIntensity',
        label: 'Intensity',
        type: 'number', min: 0, max: 5, step: 0.01,
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
        type: 'number', min: -180, max: 180, step: 1,
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
        type: 'enum',
        options: optionsFrom(FOG_MODE_LABELS),
        visibleWhen: isFogOn,
      },
      {
        on: 'environment',
        key: 'fogNear',
        label: 'Start',
        type: 'number', min: 0, step: 1,
        visibleWhen: (scene) => isFogOn(scene) && scene.environment.fogMode === 'linear',
      },
      {
        on: 'environment',
        key: 'fogFar',
        label: 'End',
        type: 'number', min: 0, step: 1,
        visibleWhen: (scene) => isFogOn(scene) && scene.environment.fogMode === 'linear',
      },
      {
        on: 'environment',
        key: 'fogDensity',
        label: 'Density',
        // Exponential in effect as well as in name: 0.05 already closes the
        // horizon at about forty units.
        type: 'number', min: 0, max: 0.2, step: 0.001,
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

