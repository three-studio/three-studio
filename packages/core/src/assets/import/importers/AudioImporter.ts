import type { AssetKind, AudioSettings } from '../../schema';
import { AssetImporter } from '../AssetImporter';
import { field, type ImportField } from '../ImportField';

export class AudioImporter extends AssetImporter<AudioSettings> {
  readonly id = 'audio';
  readonly kind: AssetKind = 'audio';
  readonly directory = 'audio';
  readonly extensions = ['mp3', 'ogg', 'wav', 'm4a', 'aac', 'flac', 'opus'];

  defaultSettings(): AudioSettings {
    // Most imports are short effects; long music is switched to streaming by
    // hand, the same call Unity's load type asks the author to make.
    return { kind: 'audio', loadMode: 'decode', gain: 1, forceMono: false };
  }

  override fields(): readonly ImportField[] {
    return [
      field.group('Audio', [
        field.enum('loadMode', 'Load type', [
          { value: 'decode', label: 'Decompress on load' },
          { value: 'stream', label: 'Streaming' },
        ]),
        field.number('gain', 'Gain', { min: 0, max: 4, step: 0.01 }),
        field.toggle('forceMono', 'Force mono'),
      ]),
    ];
  }
}
