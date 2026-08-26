import { isTslMaterial, type AssetKind, type MaterialSettings } from '../../schema';
import type { PrefabSettings, ScriptSettings, ShaderSettings } from '../../schema';
import { AssetImporter } from '../AssetImporter';
import { field, type ImportField } from '../ImportField';

/**
 * The formats the editor writes itself, plus the two source kinds.
 *
 * They share a file because none of them has anything to decide at import time:
 * a prefab and a material come out of the editor already shaped, and a script
 * is a module. Giving each a file of its own would be nine lines of ceremony
 * around one line of answer.
 */

/**
 * Prefabs, registered before materials.
 *
 * Both end in `.json`, and a bare `.json` has to keep landing on `material` —
 * projects already have such files with sidecars, and reclassifying one would
 * orphan its sidecar and break every scene that references it. So the prefab
 * importer claims only its double extension, and the material importer takes
 * the ambiguous rest.
 */
export class PrefabImporter extends AssetImporter<PrefabSettings> {
  readonly id = 'prefab';
  readonly kind: AssetKind = 'prefab';
  readonly directory = 'prefabs';
  readonly extensions = [];
  override readonly suffixes = ['.prefab.json'];

  defaultSettings(): PrefabSettings {
    return { kind: 'prefab' };
  }
}

export class MaterialImporter extends AssetImporter<MaterialSettings> {
  readonly id = 'material';
  readonly kind: AssetKind = 'material';
  readonly directory = 'materials';
  readonly extensions = ['json'];
  override readonly suffixes = ['.material.ts', '.material.js', '.material.json'];

  defaultSettings(fileName: string): MaterialSettings {
    return { kind: 'material', authoring: isTslMaterial(fileName) ? 'tsl' : 'preset' };
  }
}

export class ScriptImporter extends AssetImporter<ScriptSettings> {
  readonly id = 'script';
  readonly kind: AssetKind = 'script';
  readonly directory = 'scripts';
  readonly extensions = ['ts', 'js'];

  defaultSettings(): ScriptSettings {
    return { kind: 'script' };
  }
}

export class ShaderImporter extends AssetImporter<ShaderSettings> {
  readonly id = 'shader';
  readonly kind: AssetKind = 'shader';
  readonly directory = 'shaders';
  readonly extensions = ['wgsl'];

  defaultSettings(): ShaderSettings {
    // Compute shaders are the exception, so they are opted into by hand.
    return { kind: 'shader', stage: 'render' };
  }

  override fields(): readonly ImportField[] {
    return [
      field.group('Shader', [
        field.enum('stage', 'Stage', [
          { value: 'render', label: 'Render' },
          { value: 'compute', label: 'Compute' },
        ]),
      ]),
    ];
  }
}
