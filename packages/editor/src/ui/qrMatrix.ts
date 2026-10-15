import { encodeQR } from 'qr';

/*
 * A QR code as modules, and the modules as one SVG path. Pure, so a test can
 * read the code back with the decoder that ships beside the encoder.
 */

/**
 * Light modules all round the code: the quiet zone the standard asks for. `qr`
 * leaves two unless told otherwise, and with two some phone cameras never find
 * the code against what surrounds it on screen.
 */
const QUIET_ZONE = 4;

/**
 * The modules of a code for `text`, row by row, `true` dark, quiet zone
 * included.
 *
 * Error correction M: a code on a screen meets glare and moiré rather than
 * tears and stains, and M keeps a link of a few dozen characters at a size a
 * camera reads from arm's length.
 */
export function qrMatrix(text: string): boolean[][] {
  return encodeQR(text, 'raw', { ecc: 'medium', border: QUIET_ZONE });
}

/**
 * The dark modules as a single path, one rectangle per run along a row, in
 * module units: a few hundred short commands rather than a thousand `<rect>`s.
 */
export function qrPath(matrix: readonly (readonly boolean[])[]): string {
  let path = '';
  matrix.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (row[x]) x += 1;
      const run = x - start;
      path += `M${start} ${y}h${run}v1h-${run}z`;
    }
  });
  return path;
}
