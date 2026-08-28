import {
  basePathProblem,
  normalizeBasePath,
  type BuildProfile,
  type BuildProfiles,
  type BuildTargetId,
} from '@three-studio/core';
import { Copy, FolderOpen, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { runExport } from '../commands/exportCommands';
import { useProjectStore } from '../state/projectStore';
import { notify } from '../state/toastStore';
import { Field, Modal, type ModalSection } from '../ui/Modal';

/**
 * Configures and starts a build.
 *
 * Profiles down the left and the selected one on the right, as Unity's Build
 * Profiles window does — and for the same reason: what a build contains is a
 * saved, named thing that lives with the project, not a form filled in from
 * scratch each time and forgotten.
 *
 * One target exists. It is presented as a choice anyway, because the shape of
 * the dialog is what makes a second one cheap, and because a picker that
 * appears the day a target lands is a redesign rather than an addition.
 */

const TARGETS: Record<BuildTargetId, { label: string; description: string }> = {
  web: {
    label: 'Web',
    description: 'A folder of static files. Serve it from anywhere; no runtime is needed.',
  },
};

const INPUT =
  'w-full rounded-xs border border-line-soft bg-surface-0 px-2 py-1 text-2xs text-ink outline-none focus:border-accent';

export function PackageDialog({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((s) => s.project);
  const [draft, setDraft] = useState<BuildProfiles | null>(project?.settings.build ?? null);
  const [activeId, setActiveId] = useState(project?.settings.build.active ?? 'web');
  const [busy, setBusy] = useState(false);

  if (!project || !draft) return null;

  const profile = draft.profiles[activeId];
  const ids = Object.keys(draft.profiles);
  const sections: readonly ModalSection[] = ids.map((id) => ({
    id,
    label: draft.profiles[id]?.name ?? id,
    group: 'Profiles',
  }));

  const patch = (changes: Partial<BuildProfile>) => {
    if (!profile) return;
    setDraft({
      ...draft,
      profiles: { ...draft.profiles, [activeId]: { ...profile, ...changes } },
    });
  };

  const persist = async (next: BuildProfiles): Promise<void> => {
    const saved = await window.studio.project.updateSettings({ build: next });
    useProjectStore.getState().adoptProject(saved);
  };

  const save = () => {
    setBusy(true);
    void persist({ ...draft, active: activeId })
      .then(() => {
        notify({ kind: 'success', title: 'Build profile saved' });
        onClose();
      })
      .catch((cause: unknown) => {
        notify({
          kind: 'error',
          title: 'Could not save the profile',
          description: cause instanceof Error ? cause.message : String(cause),
        });
      })
      .finally(() => setBusy(false));
  };

  const build = () => {
    setBusy(true);
    // Saved first: a build must be reproducible from what is on disk, not from
    // what happened to be typed into a dialog that is about to close.
    void persist({ ...draft, active: activeId })
      .then(() => {
        onClose();
        runExport(activeId);
      })
      .catch((cause: unknown) => {
        notify({
          kind: 'error',
          title: 'Could not start the build',
          description: cause instanceof Error ? cause.message : String(cause),
        });
      })
      .finally(() => setBusy(false));
  };

  const duplicate = () => {
    if (!profile) return;
    const id = `${activeId}-copy-${Object.keys(draft.profiles).length}`;
    setDraft({
      ...draft,
      profiles: { ...draft.profiles, [id]: { ...profile, name: `${profile.name} copy` } },
    });
    setActiveId(id);
  };

  const remove = () => {
    if (ids.length <= 1) return; // A project with no profile could not build.
    const { [activeId]: _removed, ...rest } = draft.profiles;
    const next = Object.keys(rest)[0]!;
    setDraft({ ...draft, profiles: rest, active: next });
    setActiveId(next);
  };

  // Scene ids. Empty means "the start scene only", as the profile documents.
  const scenes = profile?.scenes.length ? profile.scenes : [project.startScene];

  // Read from the raw field rather than the normalized one, so the message
  // appears while the offending character is being typed rather than on blur.
  const baseProblem = basePathProblem(profile?.basePath ?? '');
  const base = normalizeBasePath(profile?.basePath ?? '');

  return (
    <Modal
      title="Package"
      sections={sections}
      activeSection={activeId}
      onSelectSection={setActiveId}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={duplicate}
            title="Duplicate this profile"
            className="mr-auto flex items-center gap-1 rounded-sm px-2 py-1 text-2xs text-ink-muted hover:bg-surface-3 hover:text-ink"
          >
            <Copy size={11} />
            Duplicate
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={ids.length <= 1}
            title={ids.length <= 1 ? 'A project needs at least one profile' : 'Delete this profile'}
            className="flex items-center gap-1 rounded-sm px-2 py-1 text-2xs text-ink-muted hover:bg-surface-3 hover:text-error disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-muted"
          >
            <Trash2 size={11} />
            Delete
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-sm px-3 py-1 text-2xs text-ink-muted hover:bg-surface-3 hover:text-ink disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            onClick={build}
            // No ellipsis and disabled without a folder: the button no longer
            // asks for anything, and a label promising a question it will not
            // ask is worse than a disabled one.
            disabled={busy || !profile?.outputDir || baseProblem !== null}
            title={
              baseProblem ?? (profile?.outputDir ? undefined : 'Choose an output folder first')
            }
            className="rounded-sm bg-accent-dim px-3 py-1 text-2xs text-ink hover:bg-accent/40 disabled:opacity-50"
          >
            Build
          </button>
        </>
      }
    >
      {!profile ? null : (
        <section>
          <h3 className="mb-3 text-2xs font-medium text-ink">{profile.name}</h3>

          <Field label="Profile name">
            <input
              value={profile.name}
              onChange={(event) => patch({ name: event.target.value })}
              className={INPUT}
            />
          </Field>

          <Field label="Target" hint={TARGETS[profile.target].description}>
            <select
              value={profile.target}
              onChange={(event) => patch({ target: event.target.value as BuildTargetId })}
              className={INPUT}
            >
              {Object.entries(TARGETS).map(([id, target]) => (
                <option key={id} value={id}>
                  {target.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Title" hint="Shown in the browser tab and on the loading screen.">
            <input
              value={profile.title}
              onChange={(event) => patch({ title: event.target.value })}
              className={INPUT}
            />
          </Field>

          <Field
            label="Base URL"
            hint="Where this build will be served from. Empty keeps every URL relative to the page, which works at any address ending in a slash. Otherwise “/” for a site root, “/games/demo/” for a subdirectory, or a full origin such as “http://localhost:8080/” — which then has to send CORS headers."
          >
            <input
              value={profile.basePath ?? ''}
              placeholder="relative to the page"
              // The raw value, not the normalized one: normalizing on every
              // keystroke appends a slash to “/g” and puts the caret behind it,
              // so “/games/” could not be typed. Blur is late enough.
              onChange={(event) => patch({ basePath: event.target.value })}
              onBlur={(event) => patch({ basePath: normalizeBasePath(event.target.value) })}
              className={INPUT}
            />
            {baseProblem ? (
              <p className="mt-1 text-2xs text-error">{baseProblem}</p>
            ) : (
              // The resolved example, so a missing trailing slash is visible
              // here rather than as a folder of 404s after the export.
              <p className="mt-1 truncate text-2xs text-ink-dim" title={`${base}assets/…`}>
                {base === '' ? 'Resolved against the page address.' : `→ ${base}assets/…`}
              </p>
            )}
          </Field>

          <hr className="my-4 border-line" />

          <Field
            label="Scenes"
            hint="The first one is the entry point; the rest ship beside it for a script to load."
          >
            <div className="rounded-xs border border-line-soft bg-surface-0">
              {project.scenes.map((scene, index) => {
                const checked = scenes.includes(scene.id);
                const isEntry = checked && scenes[0] === scene.id;
                return (
                  <label
                    key={scene.id}
                    className="flex items-center gap-2 border-b border-line-soft/40 px-2 py-1.5 last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        // Kept in the project's own order, so the entry point
                        // does not change with the order things were ticked.
                        const next = project.scenes
                          .filter((candidate) =>
                            candidate.id === scene.id
                              ? event.target.checked
                              : scenes.includes(candidate.id),
                          )
                          .map((candidate) => candidate.id);
                        patch({ scenes: next });
                      }}
                    />
                    <span className="flex-1 truncate text-2xs text-ink">{scene.name}</span>
                    {isEntry && <span className="text-2xs text-ink-dim">entry</span>}
                    {index === 0 && !checked && (
                      <span className="text-2xs text-warn">start scene</span>
                    )}
                  </label>
                );
              })}
            </div>
          </Field>

          <Field
            label="Include every asset"
            hint="Ships the whole project rather than what the scenes reach. Needed when a script loads an asset by name, which no static walk can see."
          >
            <input
              type="checkbox"
              checked={profile.includeAllAssets}
              onChange={(event) => patch({ includeAllAssets: event.target.checked })}
            />
          </Field>

          <Field
            label="Output folder"
            hint="Where the build is written. Existing files with the same names are replaced."
          >
            <div className="flex items-center gap-2">
              <p
                className={`min-w-0 flex-1 truncate py-1 text-2xs ${
                  profile.outputDir ? 'text-ink' : 'text-ink-dim'
                }`}
                title={profile.outputDir ?? undefined}
              >
                {profile.outputDir ?? 'No folder chosen'}
              </p>
              <button
                type="button"
                onClick={() => {
                  void window.studio.build
                    .chooseOutputDir(profile.outputDir)
                    // `null` is a dismissed picker: leave what was there.
                    .then((chosen) => chosen && patch({ outputDir: chosen }));
                }}
                className="flex shrink-0 items-center gap-1 rounded-sm bg-surface-3 px-2 py-1 text-2xs text-ink hover:bg-surface-4"
              >
                <FolderOpen size={11} />
                Choose…
              </button>
            </div>
          </Field>
        </section>
      )}
    </Modal>
  );
}
