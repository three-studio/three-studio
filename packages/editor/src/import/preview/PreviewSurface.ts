import type { AssetKind, AssetSettings } from '@three-studio/core';
import type { AssetFacts } from './facts';

/**
 * One way of showing a file that has not been imported yet.
 *
 * A strategy per kind, chosen at the moment a row is selected: a model gets a
 * scene it can be turned around in, an image gets drawn, a sound gets played.
 * They share only this interface, because they share nothing else — and the
 * dialog is written against it so that adding a fourth is adding a file.
 */
export interface PreviewSurface {
  /**
   * Attaches to the element and reads the file.
   *
   * Resolves with what it learned, which is the same pass that produced the
   * picture — a model's bounding box is not worth a second load.
   */
  open(container: HTMLElement, url: string): Promise<AssetFacts | null>;

  /** Re-applies what the author changed, without reading the file again. */
  update?(settings: AssetSettings): void;

  dispose(): void;
}

/**
 * Chosen lazily so the cost of each lands only on the kind that needs it: the
 * model preview pulls in a renderer and the loaders, which is not something a
 * dialog full of PNGs should pay for.
 */
export async function previewFor(kind: AssetKind | null): Promise<PreviewSurface | null> {
  switch (kind) {
    case 'model':
      return new (await import('./ModelPreview')).ModelPreview();
    case 'texture':
      return new (await import('./ImagePreview')).ImagePreview();
    case 'audio':
      return new (await import('./AudioPreview')).AudioPreview();
    default:
      return null;
  }
}
