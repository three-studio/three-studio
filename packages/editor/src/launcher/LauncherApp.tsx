import { ENGINE_NAME, ENGINE_VERSION, type ProjectSummary } from '@three-studio/core';
import { FolderOpen, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isMac } from '../platform';
import { LauncherScene } from './LauncherScene';
import { StudioLogo } from './StudioLogo';

type Mode = 'list' | 'create';

/**
 * The window that picks a project.
 *
 * It never opens one itself: it hands a path to `launch`, and the main process
 * builds the editor window that will do the reading. This window is destroyed
 * moments later, so anything it loaded would be thrown away — and the project
 * would be registered as open in a renderer that no longer exists.
 */
export function LauncherApp() {
  const [recent, setRecent] = useState<ProjectSummary[]>([]);
  const [mode, setMode] = useState<Mode>('list');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void window.studio.project.listRecent().then(setRecent);
  }, []);

  useEffect(refresh, [refresh]);

  /**
   * Wraps every bridge call so a rejected promise surfaces instead of vanishing.
   *
   * `busy` is never cleared on the way to a project: the window is about to be
   * replaced, and re-enabling the buttons only invites a second click that
   * would open a second window.
   */
  const run = useCallback(
    async (action: () => Promise<{ launched: boolean }>) => {
      setBusy(true);
      setError(null);
      try {
        const { launched } = await action();
        if (launched) return;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
      setBusy(false);
      refresh();
    },
    [refresh],
  );

  const launch = (projectPath: string) =>
    run(async () => {
      await window.studio.project.launch(projectPath);
      return { launched: true };
    });

  return (
    <div className="flex h-full w-full bg-surface-0">
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="app-drag h-9 shrink-0" style={{ paddingLeft: isMac ? 78 : 8 }} />

        <div className="flex min-h-0 flex-1 flex-col gap-5 px-9 pb-9">
          <header className="flex items-end gap-3">
            <h1 className="sr-only">{ENGINE_NAME}</h1>
            <StudioLogo className="h-8 w-auto text-ink" />
            <span className="pb-0.5 text-2xs text-ink-dim">v{ENGINE_VERSION}</span>
          </header>

          {error && (
            <p
              className="rounded-sm border border-error/40 bg-error/10 px-3 py-2 text-error"
              data-selectable
            >
              {error}
            </p>
          )}

          {mode === 'create' ? (
            <CreateProjectForm
              busy={busy}
              onCancel={() => setMode('list')}
              onSubmit={(name, directory) =>
                run(async () => {
                  const created = await window.studio.project.create({ name, directory });
                  await window.studio.project.launch(created.summary.path);
                  return { launched: true };
                })
              }
            />
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setMode('create')}
                className="flex flex-1 items-center justify-center gap-2 rounded-sm bg-accent px-4 py-2.5 font-medium text-white hover:bg-accent/85 disabled:opacity-50"
              >
                <Plus size={15} />
                New Project
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const picked = await window.studio.project.browseForProject();
                    if (picked === null) return { launched: false };
                    await window.studio.project.launch(picked);
                    return { launched: true };
                  })
                }
                className="flex flex-1 items-center justify-center gap-2 rounded-sm bg-surface-2 px-4 py-2.5 text-ink hover:bg-surface-3 disabled:opacity-50"
              >
                <FolderOpen size={15} />
                Open Project
              </button>
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <h2 className="text-2xs uppercase tracking-wider text-ink-dim">Recent</h2>

            {recent.length === 0 ? (
              <p className="text-2xs text-ink-dim">No projects yet.</p>
            ) : (
              <ul className="-mx-2 flex min-h-0 flex-1 flex-col overflow-auto">
                {recent.map((entry) => (
                  <li key={entry.path} className="group flex items-center">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => launch(entry.path)}
                      className="min-w-0 flex-1 rounded-sm px-2 py-1.5 text-left hover:bg-surface-2 disabled:opacity-50"
                    >
                      <span className="block truncate text-ink">{entry.name}</span>
                      <span className="block truncate text-2xs text-ink-dim">{entry.path}</span>
                    </button>
                    <button
                      type="button"
                      title="Remove from list"
                      onClick={() =>
                        run(async () => {
                          await window.studio.project.forget(entry.path);
                          return { launched: false };
                        })
                      }
                      className="mr-2 rounded-sm p-1 text-ink-dim opacity-0 hover:bg-surface-3 hover:text-ink group-hover:opacity-100"
                    >
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <Illustration />
    </div>
  );
}

/**
 * The blocks beside the list.
 *
 * Its own component so the scene mounts and unmounts with the panel, and the
 * GPU device is not left to the window's teardown.
 */
function Illustration() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let scene: LauncherScene | null = null;
    let cancelled = false;
    void LauncherScene.create(canvas).then((created) => {
      // Mounted and unmounted before the device arrived: take it straight back
      // down rather than leave it drawing into a canvas that is gone.
      if (cancelled) created?.dispose();
      else scene = created;
    });

    return () => {
      cancelled = true;
      scene?.dispose();
    };
  }, []);

  return (
    <aside
      // Fixed share of the window, which is not resizable: the composition is
      // designed at one size and stays there.
      className="app-drag relative w-[46%] shrink-0 overflow-hidden bg-surface-1"
    >
      {/* Behind the canvas, so a machine with no WebGPU still gets a backdrop
          rather than a flat grey rectangle. */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_70%_20%,theme(colors.accent/18%),transparent_70%)]" />
      <canvas ref={canvasRef} className="relative h-full w-full" />
      {/* Feathers the seam so the panel reads as one surface with the list. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-surface-0 to-transparent" />
    </aside>
  );
}

function CreateProjectForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (name: string, directory: string) => void;
}) {
  const [name, setName] = useState('My Game');
  const [directory, setDirectory] = useState('');

  const canSubmit = name.trim() !== '' && directory !== '' && !busy;

  return (
    <form
      className="flex flex-col gap-3 rounded-sm border border-line-soft bg-surface-1 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit(name, directory);
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-2xs text-ink-muted">Project name</span>
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="rounded-sm bg-surface-3 px-2 py-1.5 text-ink outline-none focus:ring-1 focus:ring-accent"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-2xs text-ink-muted">Location</span>
        <div className="flex gap-2">
          <input
            readOnly
            value={directory}
            placeholder="Choose a folder…"
            className="min-w-0 flex-1 rounded-sm bg-surface-3 px-2 py-1.5 text-ink-muted outline-none"
          />
          <button
            type="button"
            onClick={() => {
              void window.studio.project.pickDirectory().then((picked) => {
                if (picked) setDirectory(picked);
              });
            }}
            className="rounded-sm bg-surface-3 px-3 text-ink hover:bg-surface-4"
          >
            Browse…
          </button>
        </div>
        {directory !== '' && (
          // The exact folder name is decided by the main process, which strips
          // characters the platform reserves — so don't promise a literal path.
          <span className="text-2xs text-ink-dim">A folder for the project is created here.</span>
        )}
      </label>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-sm px-3 py-1.5 text-ink-muted hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-sm bg-accent px-4 py-1.5 font-medium text-white hover:bg-accent/85 disabled:opacity-40"
        >
          Create
        </button>
      </div>
    </form>
  );
}
