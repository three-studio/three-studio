import type { AssetEntry, AssetKind } from '@three-studio/core';
import {
  Box,
  Boxes,
  FileCode,
  Image,
  Palette,
  Sparkles,
  Volume2,
  type LucideIcon,
} from 'lucide-react';
import type { AssetSortKey } from '../../state/assetStore';

export const KIND_ICON: Record<AssetKind, LucideIcon> = {
  model: Box,
  texture: Image,
  material: Palette,
  prefab: Boxes,
  shader: Sparkles,
  audio: Volume2,
  script: FileCode,
};

/**
 * One label per kind, in the order the filter row offers them.
 *
 * Explicit rather than pluralised: naive pluralisation gives "Audios". Total
 * rather than a list, and that is the fix — the list this replaces had lost
 * `prefab`, so prefabs were unfilterable and nothing could say so. A `Record`
 * keyed on the union cannot lose a member without failing to compile, which is
 * the same remedy the permissive lists got in T-005.
 */
const KIND_LABELS: Record<AssetKind, string> = {
  model: 'Models',
  texture: 'Textures',
  material: 'Materials',
  prefab: 'Prefabs',
  shader: 'Shaders',
  audio: 'Audio',
  script: 'Scripts',
};

export const KIND_FILTERS: readonly { value: AssetKind | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  // The cast is `Object.entries` widening the key to `string`, and nothing more.
  ...Object.entries(KIND_LABELS).map(([value, label]) => ({ value: value as AssetKind, label })),
];

export const SORT_LABELS: Record<AssetSortKey, string> = {
  name: 'Name',
  importedAt: 'Date',
  sizeBytes: 'Size',
  kind: 'Type',
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A clip's length, channels and rate, when the sidecar knows them.
 *
 * `null` rather than a placeholder: a file adopted by the scan never went
 * through the dialog that decodes it, and there is no `decodeAudioData` under
 * Node for the main process to fill the gap with (ADR-0016). Saying nothing is the
 * honest answer, and the numbers appear the day the file is imported properly.
 */
export function audioLine(asset: AssetEntry): string | null {
  const settings = asset.settings;
  if (settings.kind !== 'audio' || settings.seconds === undefined) return null;
  const seconds = Math.max(0, settings.seconds);
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  const parts = [`${minutes}:${String(rest).padStart(2, '0')}`];
  if (settings.channels !== undefined) parts.push(settings.channels === 1 ? 'mono' : 'stereo');
  if (settings.sampleRate !== undefined) parts.push(`${Math.round(settings.sampleRate / 1000)} kHz`);
  return parts.join(' · ');
}
