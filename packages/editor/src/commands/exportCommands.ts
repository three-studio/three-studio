import { useToastStore } from '../state/toastStore';

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
      const counts = [
        `${result.sceneCount} scene${result.sceneCount === 1 ? '' : 's'}`,
        `${result.assetCount} asset${result.assetCount === 1 ? '' : 's'}`,
        `${result.scriptCount} script${result.scriptCount === 1 ? '' : 's'}`,
      ].join(' · ');

      useToastStore.getState().update(id, {
        kind: result.warnings.length > 0 ? 'warning' : 'success',
        title: result.warnings.length > 0 ? 'Packaged with warnings' : 'Packaged',
        description: counts,
        progress: undefined,
        details: result.warnings.length > 0 ? result.warnings.join('\n') : result.outputDir,
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
