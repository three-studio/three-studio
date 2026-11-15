import { formatDiagnostics, type RefusedFile } from '@three-studio/core';
import { notify } from './toastStore';

/** How many files the warning names before it counts the rest. */
const NAMED = 3;

/**
 * Says, when a project opens, which of its files this build refused to read —
 * a scene the menu cannot list, a prefab the library leaves out — each with
 * every fault where it sits.
 *
 * Each file whole in the Console, through `console.warn`, which `captureConsole`
 * puts in the Console panel beside the rest of what the project said as it
 * opened: a refusal can run to twenty lines, and that is where they can be read
 * and copied. One warning names them, and does not go away on its own, since
 * a file that is not read is work that is not on screen.
 */
export function reportRefusals(files: readonly RefusedFile[]): void {
  if (files.length === 0) return;
  for (const file of files) console.warn(formatDiagnostics(file.path, file.diagnostics));

  const named = files
    .slice(0, NAMED)
    .map((file) => file.path)
    .join(', ');
  const rest = files.length > NAMED ? `, and ${files.length - NAMED} more` : '';
  notify({
    kind: 'warning',
    title: files.length === 1 ? '1 file could not be read' : `${files.length} files could not be read`,
    description: `${named}${rest}. The Console says what each holds that this version of the editor cannot read.`,
  });
}
