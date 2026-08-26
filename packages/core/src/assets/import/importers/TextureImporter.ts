import type { AssetKind, TextureEncoding, TextureSettings } from '../../schema';
import { AssetImporter } from '../AssetImporter';
import { field, type ImportField } from '../ImportField';

/** Formats whose extension already says they store light rather than pixels. */
const HDR_EXTENSIONS = new Set(['hdr', 'exr']);

/**
 * Images, whether they end up on a surface or in the sky.
 *
 * `hdr` and `exr` are here for environment maps rather than for surfaces; both
 * decode through their own loader. `ktx2` is listed so the file is tracked, but
 * it needs a transcoder the bundle does not carry yet.
 */
export class TextureImporter extends AssetImporter<TextureSettings> {
  readonly id = 'texture';
  readonly kind: AssetKind = 'texture';
  readonly directory = 'textures';
  readonly extensions = ['png', 'jpg', 'jpeg', 'webp', 'ktx2', 'hdr', 'exr'];

  defaultSettings(fileName: string): TextureSettings {
    const extension = fileName.toLowerCase().split('.').pop();
    // As much as a name can say. `ultrahdr` is never reached from here — it
    // needs the file, and `sniffTextureEncoding` in the main process is what
    // upgrades this before the sidecar is written.
    const encoding: TextureEncoding = HDR_EXTENSIONS.has(extension ?? '') ? 'hdr' : 'sdr';
    return {
      kind: 'texture',
      // Most imports are base-colour maps; a normal map is retagged by hand.
      colorSpace: 'srgb',
      wrap: 'repeat',
      flipY: true,
      encoding,
      generateMipmaps: true,
      anisotropy: 1,
    };
  }

  override fields(settings: TextureSettings): readonly ImportField[] {
    return [
      field.group('Texture', [
        field.enum('colorSpace', 'Colour space', [
          { value: 'srgb', label: 'sRGB (colour)' },
          { value: 'linear', label: 'Linear (data)' },
        ]),
        field.enum('wrap', 'Wrap', [
          { value: 'repeat', label: 'Repeat' },
          { value: 'clamp', label: 'Clamp' },
          { value: 'mirror', label: 'Mirror' },
        ]),
        field.toggle('flipY', 'Flip Y'),
        field.toggle('generateMipmaps', 'Generate mipmaps'),
        // Pointless without mipmaps — it is a choice about how they are
        // sampled — so the row goes away rather than sitting there inert.
        ...(settings.generateMipmaps
          ? [field.number('anisotropy', 'Anisotropy', { min: 1, max: 16, step: 1 })]
          : []),
      ]),
    ];
  }
}
