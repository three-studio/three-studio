import type { FbxModelSettings } from '../../schema';
import { field, type ImportField } from '../ImportField';
import { ModelImporter } from './ModelImporter';

/**
 * FBX — what comes out of every DCC tool, and the format most likely to arrive
 * in the wrong units.
 *
 * Self-contained: textures are embedded or referenced absolutely, so there is
 * nothing to bring along.
 */
export class FbxImporter extends ModelImporter<FbxModelSettings> {
  readonly id = 'model.fbx';
  readonly extensions = ['fbx'];
  override get label(): string {
    return 'FBX';
  }

  defaultSettings(): FbxModelSettings {
    return { ...this.baseDefaults(), format: 'fbx', collisionMeshes: 'ignore' };
  }

  protected override formatFields(): readonly ImportField[] {
    return [
      field.group('FBX', [
        field.enum('collisionMeshes', 'Collision meshes', [
          { value: 'ignore', label: 'Ignore UCX_ nodes' },
          { value: 'keep', label: 'Import as geometry' },
        ]),
      ]),
    ];
  }
}
