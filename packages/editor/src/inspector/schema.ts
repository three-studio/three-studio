import { environmentSchema, type EnvironmentDef, type SceneDoc, type SkySettings } from '@three-studio/core';
import { leafRow } from './derivePane';
import type { DistributiveOmit, FieldSpec } from './fields';
import { shapeOf } from './signature';

/*
 * The scene pane, and the door onto the field vocabulary.
 *
 * A component's pane is derived from its type's fields (`derivePane.ts`), with
 * what the type's `components/<type>/pane.ts` adds. What stays here is what is
 * not per-type: the environment's own pane, and a re-export of `fields.ts` so
 * that nothing which writes a field has to know where the vocabulary lives.
 */
export {
  ASSET_SLOT,
  assetSlot,
  isAction,
  isSeparator,
  type ActionSpec,
  type BoundSpec,
  type FieldSpec,
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
 *
 * `prefabOpen` is the one thing read from outside the document: with a prefab
 * open, the document is the prefab, and the pane is the prefab's.
 */
export type SceneSubject = Pick<SceneDoc, 'environment'> & { prefabOpen: boolean };

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
 * One folder of the scene pane. Rows as a component's pane has, because they
 * are bound by the same code — only the subject differs.
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

/** A key of the environment that holds one value: all but the sky, an object of its own. */
type EnvironmentKey = Exclude<keyof EnvironmentDef, 'sky'>;

/**
 * A row of the environment, its label, range, options and unit read off
 * `environmentSchema`: those facts are the field's, and the section a row sits
 * in and the condition it is shown under are this pane's.
 */
function environmentRow(key: EnvironmentKey, visibleWhen?: (scene: SceneSubject) => boolean): SceneField {
  const { path: _path, ...row } = leafRow<SceneSubject>(environmentSchema[key], [key]);
  return { on: 'environment', key, ...row, ...(visibleWhen === undefined ? {} : { visibleWhen }) };
}

/** One of the sky's uniforms, read as `environmentRow` reads a field of the environment. */
function skyRow(key: keyof SkySettings): SceneField {
  const { path: _path, ...row } = leafRow<SceneSubject>(environmentSchema.sky.fields[key], [key]);
  return { on: 'sky', key, ...row };
}

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
    // Not while a prefab is open. The field named the scene, which is not on
    // screen then, and leaving it renamed the scene's file — from a blur, with
    // nothing asked. Scene ▸ Rename Scene… does that, after asking.
    visibleWhen: (scene) => !scene.prefabOpen,
    // The scene's *address*, not `SceneDoc.name`: writing it moves the file,
    // because the file name is the name. See the `on: 'scene'`
    // branch in `buildInspector`.
    fields: [{ on: 'scene', key: 'name', label: 'Name' }],
  },
  {
    label: 'Background',
    fields: [
      environmentRow('backgroundMode'),
      environmentRow('background', (scene) => scene.environment.backgroundMode === 'color'),
      environmentRow('backgroundTexture', showsTexture),
      environmentRow('backgroundIntensity', showsImageBackground),
      // Only the sky, never the reflections — which is the point of having it:
      // a blurred backdrop behind sharp reflections is how a subject is put in
      // front of an environment without it reading as a photograph. Texture
      // only, and it loses nothing: an analytic sky is already smooth, has no
      // detail to lose, and as a mesh has no mip chain to sample.
      environmentRow('backgroundBlur', showsTexture),
    ],
  },
  {
    label: 'Environment',
    fields: [
      environmentRow('environmentMode'),
      environmentRow('environmentTexture', (scene) => scene.environment.environmentMode === 'texture'),
      environmentRow('environmentIntensity', (scene) => scene.environment.environmentMode !== 'none'),
      // Turns the sky and the light it casts together. Degrees in the panel,
      // radians in the document, like every other rotation the Inspector shows.
      environmentRow('rotation', turnsAnImage),
    ],
  },
  {
    label: 'Sky',
    // The analytic sky is authored where it is shown. It stays in the document
    // when the mode moves off it, like the background colour and the texture —
    // switching away must not lose what was set up.
    visibleWhen: (scene) => scene.environment.backgroundMode === 'sky',
    fields: [
      skyRow('elevation'),
      skyRow('azimuth'),
      skyRow('turbidity'),
      skyRow('rayleigh'),
      skyRow('mieCoefficient'),
      skyRow('mieDirectionalG'),
      // The sky as seen only. The capture that lights the scene never carries
      // the disc, whatever this says — see `ProceduralSky.radiance`.
      skyRow('sunDisc'),
      skyRow('cloudCoverage'),
      skyRow('cloudDensity'),
      skyRow('cloudScale'),
      skyRow('cloudElevation'),
      // Authored, and inert until three fixes `SkyMesh`: its `time` uniform is
      // never updated, so the clouds hold still at any speed. Not a fault of
      // this application — a plain TSL material animates fine beside it.
      skyRow('cloudSpeed'),
    ],
  },
  {
    label: 'Fog',
    fields: [
      environmentRow('fogEnabled'),
      environmentRow('fogColor', isFogOn),
      environmentRow('fogMode', isFogOn),
      environmentRow('fogNear', (scene) => isFogOn(scene) && scene.environment.fogMode === 'linear'),
      environmentRow('fogFar', (scene) => isFogOn(scene) && scene.environment.fogMode === 'linear'),
      environmentRow('fogDensity', (scene) => isFogOn(scene) && scene.environment.fogMode === 'exponential'),
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
 * `SceneSubject`, which is what keeps that honest — and whether a prefab is
 * open, which the Scene folder reads.
 */
export function sceneSignature(environment: EnvironmentDef, prefabOpen: boolean): string {
  return shapeOf(SCENE_ENTRIES, { environment, prefabOpen });
}

