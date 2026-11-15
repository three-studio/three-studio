import { planFields, type Infer, type Schema } from '../fieldSchema';
import type { AssetId } from '../ids';

/**
 * An analytic sky, in place of a photographed one.
 *
 * The Preetham daylight model, which is what three's `SkyMesh` implements and
 * what Unity's procedural skybox and Unreal's SkyAtmosphere are. It costs no
 * asset at all and it can be pointed at an hour of the day, which no
 * photograph can — the price is that it is a clear-sky model, so it has no
 * weather beyond the cloud layer below.
 *
 * One object rather than twelve more fields on the environment, for the reason
 * a light's shadow is one: they are read and written together. Its defaults
 * are three's own `SkyMesh`'s, which are a clear early morning.
 */
const skyFields = {
  /* Degrees above the horizon. Below zero is night. */
  elevation: { type: 'number', label: 'Sun Height', default: 2, min: -10, max: 90, step: 0.1 },
  /* Degrees around it. Turns the sun, where `rotation` turns an image. */
  azimuth: { type: 'number', label: 'Sun Angle', default: 180, min: -180, max: 180, step: 1 },
  /* Haze. 2 is a clear day; above 10 reads as smog. */
  turbidity: { type: 'number', label: 'Haze', default: 2, min: 0, max: 20, step: 0.1 },
  /* How blue the sky is — the strength of the short-wavelength scattering. */
  rayleigh: { type: 'number', label: 'Blue', default: 1, min: 0, max: 4, step: 0.01 },
  /* Size of the glow around the sun. */
  mieCoefficient: { type: 'number', label: 'Sun Glow', default: 0.005, min: 0, max: 0.1, step: 0.001 },
  /* How tightly that glow hugs the sun. */
  mieDirectionalG: { type: 'number', label: 'Glow Focus', default: 0.8, min: 0, max: 1, step: 0.01 },
  /*
   * Whether the solar disc is drawn.
   *
   * Only in the sky as seen. The capture that lights the scene never has it:
   * the disc is a handful of very bright pixels, and the blur chain that makes
   * a radiance map turns them into a ring across the whole upper hemisphere —
   * which is what `SkyMesh` documents turning it off for.
   */
  sunDisc: { type: 'boolean', label: 'Sun Disc', default: true },
  cloudCoverage: { type: 'number', label: 'Cloud Cover', default: 0.4, min: 0, max: 1, step: 0.01 },
  cloudDensity: { type: 'number', label: 'Cloud Density', default: 0.4, min: 0, max: 1, step: 0.01 },
  cloudScale: { type: 'number', label: 'Cloud Scale', default: 0.0002, min: 0.00001, max: 0.001, step: 0.00001 },
  cloudElevation: { type: 'number', label: 'Cloud Height', default: 0.5, min: 0, max: 1, step: 0.01 },
  /*
   * How fast the cloud layer drifts.
   *
   * A plain rate, with no opinion about when it applies: the shader multiplies
   * it by the simulation's clock, so a stopped viewport and a paused game hold
   * the clouds still without this setting knowing either exists. See
   * `StudioTime` in the runtime.
   */
  cloudSpeed: { type: 'number', label: 'Cloud Drift', default: 0.0001, min: 0, max: 0.001, step: 0.00001 },
} as const satisfies Schema;

/**
 * What the scene looks like before anything is placed in it: the sky, the light
 * that comes off it, and the air between the camera and what it sees, as its
 * fields.
 *
 * A property of the scene rather than a component on an entity — Godot's
 * `WorldEnvironment` is the other model, and it was rejected because the
 * environment is not a thing placed in the scene. So it has no pane of its
 * own to derive: the scene pane keeps its sections and conditions, and reads
 * each row's label, range, options and unit here.
 */
export const environmentSchema = {
  /*
   * A flat colour, an equirectangular texture, or the analytic sky.
   *
   * `background` keeps its value whichever is chosen, so switching back does
   * not lose the colour — and the same is true of `backgroundTexture` and
   * `sky`. Nothing here is cleared by choosing something else.
   */
  backgroundMode: {
    type: 'enum',
    label: 'Mode',
    default: 'color',
    options: [
      { value: 'color', label: 'Colour' },
      { value: 'texture', label: 'Texture' },
      { value: 'sky', label: 'Sky' },
    ],
  },
  background: { type: 'color', label: 'Colour', default: '#2b2f33' },
  /* An equirectangular image — HDR, EXR or PNG. */
  backgroundTexture: { type: 'asset', label: 'Texture', kind: 'texture' },
  /*
   * How much of the background's own detail is thrown away, 0 to 1: three's
   * own default, no blur.
   *
   * Blurring the sky and leaving the reflections sharp is the standard way to
   * put a subject in front of an environment without the environment reading
   * as a photograph behind it.
   */
  backgroundBlur: { type: 'number', label: 'Blur', default: 0, min: 0, max: 1, step: 0.01 },
  /* Multiplies the background only. The light it casts is `environmentIntensity`. */
  backgroundIntensity: { type: 'number', label: 'Intensity', default: 1, min: 0, max: 5, step: 0.01 },
  /*
   * Where image-based lighting comes from — what every surface reflects and is
   * lit by, and the single biggest change to how a scene reads.
   *
   * `background` reuses whatever the background already is, which is the usual
   * arrangement and costs one prefiltered radiance map instead of two. `texture`
   * names its own image, which is how a small map dedicated to the lighting is
   * paired with a large one for the sky: the prefiltering throws away that
   * resolution anyway, so only the background ever needs it. `texture` is the
   * default because it is what a scene did before there was a choice: the
   * lighting came from `environmentTexture` and from nothing else.
   */
  environmentMode: {
    type: 'enum',
    label: 'Source',
    default: 'texture',
    options: [
      { value: 'none', label: 'None' },
      { value: 'background', label: 'Background' },
      { value: 'texture', label: 'Texture' },
    ],
  },
  environmentTexture: { type: 'asset', label: 'Lighting', kind: 'texture' },
  environmentIntensity: { type: 'number', label: 'Intensity', default: 1, min: 0, max: 5, step: 0.01 },
  /*
   * Turns the background and the lighting together, about Y.
   *
   * three keeps `backgroundRotation` and `environmentRotation` apart and every
   * editor that exposes either exposes one — letting the sky and the light it
   * casts disagree is a bug nobody would think to look for. Without this the
   * only way to move the sun is to re-export the image.
   */
  rotation: { type: 'number', label: 'Rotation', default: 0, min: -180, max: 180, step: 1, unit: 'radians' },
  sky: { type: 'object', label: 'Sky', fields: skyFields },
  fogEnabled: { type: 'boolean', label: 'Enabled', default: false },
  fogColor: { type: 'color', label: 'Colour', default: '#2b2f33' },
  /*
   * Linear fog ramps between two distances and is easy to place exactly;
   * exponential has no far edge, which is what makes a horizon rather than a
   * wall. `fogNear` and `fogFar` serve the first, `fogDensity` the second.
   */
  fogMode: {
    type: 'enum',
    label: 'Mode',
    default: 'linear',
    options: [
      { value: 'linear', label: 'Linear' },
      { value: 'exponential', label: 'Exponential' },
    ],
  },
  fogNear: { type: 'number', label: 'Start', default: 30, min: 0, step: 1 },
  fogFar: { type: 'number', label: 'End', default: 400, min: 0, step: 1 },
  /*
   * Exponential in effect as well as in name: 0.05 already closes the horizon
   * at about forty units. three's own default is 0.00025, which is invisible at
   * the scale a blockout is built at; Unity's 0.01 puts the horizon around 200.
   */
  fogDensity: { type: 'number', label: 'Density', default: 0.01, min: 0, max: 0.2, step: 0.001 },
} as const satisfies Schema;

export type EnvironmentDef = Infer<typeof environmentSchema>;
export type SkySettings = EnvironmentDef['sky'];
export type BackgroundMode = EnvironmentDef['backgroundMode'];
export type EnvironmentMode = EnvironmentDef['environmentMode'];
export type FogMode = EnvironmentDef['fogMode'];

const environmentPlan = planFields(environmentSchema);

/** The environment a scene starts with: the schema's defaults, a copy each time. */
export function createEnvironment(): EnvironmentDef {
  return structuredClone(environmentPlan.defaults);
}

/** A stored environment, checked field by field: see `FieldPlan.decode`. */
export const decodeEnvironment = environmentPlan.decode;

/**
 * Every asset id the environment points at.
 *
 * Asked by every walk of a scene's assets beside its components, because the
 * environment is not one — it is a property of the scene, and `eachComponent`
 * never reaches it. The sky was invisible to those walks once, so an exported
 * build shipped without it, the loading bar did not count it, and deleting it
 * announced that nothing used it.
 */
export function environmentAssets(environment: EnvironmentDef): readonly (AssetId | null)[] {
  return environmentPlan.assets(environment);
}
