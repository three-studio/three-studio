import { componentAssets } from '../components';
import { materialAssets } from '../components/materialAssets';
import { COMPONENT_TYPES, type ComponentHost } from '../scene/components';
import type { ComponentDoc, EnvironmentDef, MaterialDef, SceneDoc } from '../scene/schema';
import type { PrefabDoc } from '../scene/prefab';

/**
 * Every asset id the environment points at.
 *
 * Here rather than in the component registry because the environment is not a
 * component — it is a property of the scene, and `eachComponent` will never
 * reach it. Both walks below call this for that exact reason: the sky was
 * invisible to them, so an exported build shipped without it, the loading bar
 * did not count it, and deleting it announced that nothing used it.
 */
export function environmentAssets(environment: EnvironmentDef): readonly (string | null)[] {
  return [environment.backgroundTexture, environment.environmentTexture];
}

/**
 * Who uses an asset.
 *
 * The inverse of what the exporter collects, and it has to walk the same
 * places or the two disagree — one saying a texture ships, the other saying
 * nothing references it. It lives in core for that reason: the exporter runs
 * in the main process and this runs in the renderer, and a second walk written
 * for the second caller is how they drift.
 */
export interface AssetUsage {
  /** Entities in the scene, by id. */
  entities: string[];
  /** Material assets whose texture slots name it. */
  materials: string[];
  /** Prefab assets whose contents name it. */
  prefabs: string[];
  /**
   * The scene's own environment names it, as the background or as the light
   * that comes off it. Not a list: there is one environment, and it is not
   * addressable by id the way an entity or a material is.
   */
  environment: boolean;
}

export function isUsed(usage: AssetUsage): boolean {
  return (
    usage.entities.length > 0 ||
    usage.materials.length > 0 ||
    usage.prefabs.length > 0 ||
    usage.environment
  );
}

export function totalUses(usage: AssetUsage): number {
  return (
    usage.entities.length +
    usage.materials.length +
    usage.prefabs.length +
    (usage.environment ? 1 : 0)
  );
}

/**
 * Every asset id a component points at, directly or through its material.
 *
 * Asked of the component's own type since phase 9. This was a `switch` with four
 * branches of which three were identical, and it is the list that has to agree
 * with what the exporter ships: a slot named in one and not the other is either
 * a texture that does not arrive or a delete that claims nothing uses it.
 */
function componentNames(component: ComponentDoc): readonly (string | null)[] {
  return componentAssets(component);
}

/**
 * Finds everything that would break if this asset went away.
 *
 * Only the scene that is open: the others are files on disk this process has
 * not read, so a "nothing uses it" answer is about here and now. Saying that
 * plainly is better than a scan that pretends to be exhaustive — and the
 * alternative, reading every scene on every delete, is a round trip per file.
 */
export function findAssetUsage(
  assetId: string,
  scene: SceneDoc,
  materials: Readonly<Record<string, MaterialDef>>,
  prefabs: Readonly<Record<string, PrefabDoc>>,
): AssetUsage {
  const usage: AssetUsage = { entities: [], materials: [], prefabs: [], environment: false };
  if (assetId === '') return usage;

  const named = new Set<string>();
  for (const [entityId, component] of eachComponent(scene)) {
    if (componentNames(component).includes(assetId)) named.add(entityId);
  }
  usage.entities.push(...named);

  usage.environment = environmentAssets(scene.environment).includes(assetId);

  for (const [id, material] of Object.entries(materials)) {
    if (materialAssets(material).includes(assetId)) usage.materials.push(id);
  }

  for (const [id, prefab] of Object.entries(prefabs)) {
    for (const [, component] of eachComponent(prefab)) {
      if (componentNames(component).includes(assetId)) {
        usage.prefabs.push(id);
        break;
      }
    }
  }

  return usage;
}

/**
 * Every component in a scene or a prefab, with the entity carrying it.
 *
 * Over the component tables rather than the entity table: an entity with no
 * components is not visited at all, and the walk is the same shape for a scene
 * and a prefab — which is what these two functions have to guarantee, since one
 * says an asset ships and the other says nothing references it.
 */
function* eachComponent(host: ComponentHost): Generator<[string, ComponentDoc]> {
  for (const type of COMPONENT_TYPES) {
    // The mapped type gives a union of eleven record types when indexed by a
    // variable, and `Object.values` of a union widens to `unknown`. Every value
    // in there is a `ComponentDoc` by construction of the table.
    const table = host.components[type] as Record<string, Record<string, ComponentDoc>>;
    for (const [entityId, held] of Object.entries(table)) {
      for (const component of Object.values(held)) yield [entityId, component];
    }
  }
}

/**
 * Every asset a scene needs before it can be shown.
 *
 * The other direction from `findAssetUsage`, off the same walk. This is what a
 * loading bar counts: the document itself is a few kilobytes of JSON, and the
 * wait is entirely these.
 *
 * Follows prefabs into their contents, because an instance names one id and
 * arrives with a model and four textures behind it.
 */
export function collectSceneAssets(
  scene: SceneDoc,
  materials: Readonly<Record<string, MaterialDef>>,
  prefabs: Readonly<Record<string, PrefabDoc>>,
): string[] {
  const ids = new Set<string>();
  const seenPrefabs = new Set<string>();

  const addComponent = (component: ComponentDoc): void => {
    for (const id of componentNames(component)) {
      if (id === null || id === '') continue;
      ids.add(id);

      // A linked material's own textures: nothing else in the scene names them.
      const material = materials[id];
      if (material) {
        for (const texture of materialAssets(material)) {
          if (texture !== null && texture !== '') ids.add(texture);
        }
      }

      // A prefab that places other prefabs is followed too; `seenPrefabs`
      // stops one that contains itself from looping forever.
      const prefab = prefabs[id];
      if (prefab && !seenPrefabs.has(id)) {
        seenPrefabs.add(id);
        for (const [, inner] of eachComponent(prefab)) addComponent(inner);
      }
    }
  };

  for (const [, component] of eachComponent(scene)) addComponent(component);

  // The environment is not a component, so the walk above cannot reach it. It is
  // also the heaviest single file a scene names — an equirectangular HDR is
  // megabytes where a prop is kilobytes — which makes it the one asset a loading
  // bar most needs to be counting, and the one an export most obviously misses.
  for (const id of environmentAssets(scene.environment)) {
    if (id !== null && id !== '') ids.add(id);
  }

  return [...ids];
}

/**
 * The entities placing a given prefab.
 *
 * Separate from `findAssetUsage` because it answers a different question — not
 * "can I delete this" but "how many objects does editing this touch", which is
 * what makes an Apply safe to press.
 */
export function findPrefabInstances(assetId: string, scene: SceneDoc): string[] {
  return Object.entries(scene.components.prefabInstance)
    .filter(([, held]) =>
      Object.values(held).some((component) => component.assetId === assetId),
    )
    .map(([entityId]) => entityId);
}
