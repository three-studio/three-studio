import { useMemo } from 'react';
import { qrMatrix, qrPath } from './qrMatrix';

/**
 * A QR code a phone's camera can read off the screen.
 *
 * Black on white whatever the theme: cameras look for dark modules on a light
 * ground, and many read nothing of the inverse that a dark theme would draw.
 * Measured in modules and scaled by the browser, with edges kept crisp, so no
 * module is smudged across a pixel boundary.
 */
export function QrCode({ text, size, label }: { text: string; size: number; label: string }) {
  const { modules, path } = useMemo(() => {
    const matrix = qrMatrix(text);
    return { modules: matrix.length, path: qrPath(matrix) };
  }, [text]);

  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${modules} ${modules}`}
      shapeRendering="crispEdges"
      className="shrink-0"
    >
      <rect width={modules} height={modules} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
