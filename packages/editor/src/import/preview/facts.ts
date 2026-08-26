import type { AssetKind } from '@three-studio/core';

/**
 * What reading a file told us, for the line above the settings.
 *
 * Produced by the preview rather than by a probe of its own: a model's triangle
 * count cannot be had without opening the file, and once it is open there is a
 * picture to draw. One load, two answers.
 */
export type AssetFacts = ModelFacts | TextureFacts | AudioFacts;

export interface ModelFacts {
  kind: 'model';
  meshes: number;
  triangles: number;
  materials: number;
  animations: number;
  /** Bounding box, in the file's own units — which is the point of showing it. */
  size: readonly [number, number, number];
}

export interface TextureFacts {
  kind: 'texture';
  width: number;
  height: number;
}

export interface AudioFacts {
  kind: 'audio';
  seconds: number;
  channels: number;
  sampleRate: number;
}

/** `1.2 MB`. Decimal, as every file manager reports it. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB'];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** `48k` rather than `48213`, which nobody reads at a glance. */
export function formatCount(value: number): string {
  if (value < 1000) return `${value}`;
  if (value < 1_000_000) return `${Math.round(value / 100) / 10}k`;
  return `${Math.round(value / 100_000) / 10}M`;
}

export function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${`${whole % 60}`.padStart(2, '0')}`;
}

/** Enough precision to tell 2746 from 27.46 without a wall of decimals. */
export function formatUnits(value: number): string {
  if (value === 0) return '0';
  if (value >= 100) return `${Math.round(value)}`;
  if (value >= 1) return value.toFixed(1);
  return value.toPrecision(2);
}

/** One line summarising a file, or `null` when there is nothing worth saying. */
export function describeFacts(facts: AssetFacts | null): string | null {
  if (facts === null) return null;
  switch (facts.kind) {
    case 'model': {
      const parts = [
        `${facts.meshes} mesh${facts.meshes === 1 ? '' : 'es'}`,
        `${formatCount(facts.triangles)} tris`,
        `${facts.materials} material${facts.materials === 1 ? '' : 's'}`,
      ];
      if (facts.animations > 0) {
        parts.push(`${facts.animations} animation${facts.animations === 1 ? '' : 's'}`);
      }
      return parts.join(' · ');
    }
    case 'texture':
      return `${facts.width} × ${facts.height}`;
    case 'audio':
      return `${formatDuration(facts.seconds)} · ${
        facts.channels === 1 ? 'mono' : `${facts.channels} channels`
      } · ${Math.round(facts.sampleRate / 1000)} kHz`;
  }
}

/** Which kinds have a preview at all. The rest show their icon and their size. */
export function hasPreview(kind: AssetKind | null): boolean {
  return kind === 'model' || kind === 'texture' || kind === 'audio';
}
