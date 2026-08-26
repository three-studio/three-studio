import type { TextureFacts } from './facts';
import type { PreviewSurface } from './PreviewSurface';

/**
 * The image, on a chequerboard.
 *
 * The chequer is not decoration: half the textures anyone imports have an alpha
 * channel, and on a flat background a cut-out leaf and an opaque one look
 * identical. It is also what tells a fully transparent image from a missing one.
 *
 * Radiance, OpenEXR and KTX2 are textures the browser cannot decode, so they
 * get the same treatment they get in the asset browser: no picture, and the
 * numbers instead.
 */
export class ImagePreview implements PreviewSurface {
  private element: HTMLElement | null = null;

  open(container: HTMLElement, url: string): Promise<TextureFacts | null> {
    const board = document.createElement('div');
    board.className = 'flex h-full w-full items-center justify-center p-4';
    board.style.backgroundImage =
      'linear-gradient(45deg, #2a2a2a 25%, transparent 25%), linear-gradient(-45deg, #2a2a2a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2a2a 75%), linear-gradient(-45deg, transparent 75%, #2a2a2a 75%)';
    board.style.backgroundSize = '16px 16px';
    board.style.backgroundPosition = '0 0, 0 8px, 8px -8px, -8px 0';
    board.style.backgroundColor = '#222';
    container.append(board);
    this.element = board;

    const image = document.createElement('img');
    image.className = 'max-h-full max-w-full object-contain';
    // Nearest, so a 16×16 icon blown up reads as the pixels it is rather than
    // as a blur — and a photograph shown smaller than itself is unaffected.
    image.style.imageRendering = 'pixelated';
    board.append(image);

    return new Promise((resolve) => {
      image.addEventListener('load', () => {
        image.style.imageRendering = image.naturalWidth < 128 ? 'pixelated' : 'auto';
        resolve({
          kind: 'texture',
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
      });
      image.addEventListener('error', () => {
        // A format no `<img>` decodes. Saying so beats a broken tile, which
        // reads as a failed import rather than as a file we cannot draw.
        board.replaceChildren(message('No preview for this format'));
        resolve(null);
      });
      image.src = url;
    });
  }

  dispose(): void {
    this.element?.remove();
    this.element = null;
  }
}

function message(text: string): HTMLElement {
  const element = document.createElement('p');
  element.className = 'text-2xs text-ink-dim';
  element.textContent = text;
  return element;
}
