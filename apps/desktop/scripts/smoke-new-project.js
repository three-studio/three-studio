/*
 * `STUDIO_SMOKE_SETUP` for the first half of the CI check: make a project to
 * look at.
 *
 * The harness needs a project on disk before it can boot into an editor window,
 * and nothing outside Electron can make one — `createProject` reaches
 * `recentProjects`, which imports `electron`. So the launcher makes it, through
 * the same IPC call its own "New Project" button uses. `project:create` writes
 * the folder and adopts it; it opens no window, which is what lets this run
 * finish normally rather than destroying the page it is running in.
 *
 * `__PROJECT_DIR__` is replaced before this is handed to the harness. The
 * renderer can see no environment of its own, and the folder is a temp path the
 * runner picks, so the caller substitutes it — see `.github/workflows/ci.yml`.
 */
(async () => {
  const opened = await window.studio.project.create({
    name: 'Smoke',
    directory: '__PROJECT_DIR__',
  });
  return { verdict: 'ok', path: opened.summary.path, scene: opened.sceneId };
})();
