import type { AssetKind, BuildSize } from '@three-studio/core';
import { formatBytes } from '../import/preview/facts';
import { useToastStore } from '../state/toastStore';

/**
 * What each asset kind is called in the report.
 *
 * Total, so a kind added to the importers is a compile error here rather than a
 * row labelled `shader` among rows labelled properly.
 */
const KIND_LABELS: Record<AssetKind, string> = {
  model: 'Models',
  texture: 'Textures',
  audio: 'Audio',
  material: 'Materials',
  prefab: 'Prefabs',
  shader: 'Shaders',
  // Never in a build: scripts ship compiled, as the row below them.
  script: 'Script sources',
};

/**
 * Where the megabytes went, as a column that lines up.
 *
 * `Alert` renders `details` in a monospace block with whitespace preserved, so
 * padding is what makes this a table — and a table is what makes the question
 * answerable at a glance rather than by arithmetic.
 *
 * Biggest first, because the question is always which row to attack. Empty rows
 * are dropped: a build with no audio should not have to be read past a line
 * saying it has no audio.
 */
function breakdown(size: BuildSize): string {
  type Row = [label: string, bytes: number];

  const rows: Row[] = [
    ['Player', size.player],
    ['Scenes', size.scenes],
    ['Scripts', size.scripts],
  ];
  for (const [kind, bytes] of Object.entries(size.assets)) {
    rows.push([KIND_LABELS[kind as AssetKind], bytes]);
  }

  const shown = rows.filter(([, bytes]) => bytes > 0).sort(([, a], [, b]) => b - a);
  shown.push(['Total', size.total]);

  const labels = Math.max(...shown.map(([label]) => label.length));
  const amounts = shown.map(([, bytes]) => formatBytes(bytes));
  const width = Math.max(...amounts.map((amount) => amount.length));
  const lines = shown.map(
    ([label], index) => `${label.padEnd(labels)}  ${amounts[index]!.padStart(width)}`,
  );
  // A rule above the total, so the eye stops there rather than reading it as
  // one more category.
  lines.splice(lines.length - 1, 0, '-'.repeat(labels + 2 + width));
  return lines.join('\n');
}

/**
 * Produces a build, reporting through a toast.
 *
 * One toast for the whole run rather than one per phase: the running message
 * becomes the result, so the corner does not fill with a history of a single
 * action. The success carries a shortcut to the folder — a shortcut, not the
 * only way there, since the path is also in the message.
 */
export function runExport(profileId?: string): void {
  const toasts = useToastStore.getState();
  const id = toasts.push({
    kind: 'progress',
    title: 'Packaging…',
    description: 'Preparing',
    progress: 0,
  });

  const stopListening = window.studio.build.onProgress((progress) => {
    useToastStore.getState().update(id, {
      description: progress.step,
      progress: progress.fraction,
    });
  });

  void window.studio.build
    .export(profileId)
    .then((result) => {
      // Size first: it is the first thing anyone looks at, and the counts are
      // what it is made of.
      const counts = [
        formatBytes(result.size.total),
        `${result.sceneCount} scene${result.sceneCount === 1 ? '' : 's'}`,
        `${result.assetCount} asset${result.assetCount === 1 ? '' : 's'}`,
        `${result.scriptCount} script${result.scriptCount === 1 ? '' : 's'}`,
      ].join(' · ');

      // The breakdown and the folder, with any warnings above them: a warning
      // is why the disclosure opens itself, and the report is why it is worth
      // opening when there is none.
      const report = [breakdown(result.size), '', result.outputDir].join('\n');

      useToastStore.getState().update(id, {
        kind: result.warnings.length > 0 ? 'warning' : 'success',
        title: result.warnings.length > 0 ? 'Packaged with warnings' : 'Packaged',
        description: counts,
        progress: undefined,
        details:
          result.warnings.length > 0 ? `${result.warnings.join('\n')}\n\n${report}` : report,
        detailsOpen: result.warnings.length > 0,
        actions: [
          {
            label: 'Show in Finder',
            primary: true,
            onClick: () => void window.studio.build.revealOutput(result.outputDir),
          },
        ],
      });
    })
    .catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      useToastStore.getState().update(id, {
        kind: 'error',
        title: 'Packaging failed',
        // The first line is the message; the rest is usually an IPC wrapper,
        // which belongs behind the disclosure rather than in the title.
        description: message.split('\n')[0],
        progress: undefined,
        details: message,
        detailsOpen: false,
        actions: [],
      });
    })
    .finally(stopListening);
}
