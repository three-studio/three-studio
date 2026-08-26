import type { GltfModelSettings } from '../../schema';
import type { TextReader } from '../AssetImporter';
import { CompanionSet } from '../companions';
import { field, type ImportField } from '../ImportField';
import { ModelImporter } from './ModelImporter';

/**
 * glTF and GLB — the format to author against, since it carries PBR materials
 * the renderer maps straight onto node materials.
 *
 * `.glb` packs everything into one file. `.gltf` does not: it names its buffers
 * and images, and copying it alone leaves a file that cannot find its own
 * geometry.
 */
export class GltfImporter extends ModelImporter<GltfModelSettings> {
  readonly id = 'model.gltf';
  readonly extensions = ['glb', 'gltf'];
  override get label(): string {
    return 'glTF';
  }

  defaultSettings(): GltfModelSettings {
    return {
      ...this.baseDefaults(),
      format: 'gltf',
      importCameras: false,
      importLights: false,
    };
  }

  protected override formatFields(): readonly ImportField[] {
    return [
      field.group('glTF', [
        field.toggle('importCameras', 'Import cameras'),
        field.toggle('importLights', 'Import lights'),
      ]),
    ];
  }

  /**
   * Read from the file rather than guessed from the name: an exporter is free
   * to call the buffer anything, and most do.
   */
  override async companions(fileName: string, read: TextReader): Promise<readonly string[]> {
    if (!fileName.toLowerCase().endsWith('.gltf')) return [];

    const text = await read(fileName);
    if (text === null) return [];

    const found = new CompanionSet();
    try {
      const document = JSON.parse(text) as {
        buffers?: { uri?: string }[];
        images?: { uri?: string }[];
      };
      for (const buffer of document.buffers ?? []) found.add(buffer.uri);
      for (const image of document.images ?? []) found.add(image.uri);
    } catch {
      // Malformed: import the file as it is rather than refuse it, and let the
      // loader produce the error the author can act on.
    }
    return found.toArray();
  }
}
