import type { ProjectSettings } from '@three-studio/core';
import { useState } from 'react';
import { chooseStartScene } from '../commands/sceneFiles';
import { notify } from '../state/toastStore';
import { useProjectStore } from '../state/projectStore';
import { Field, Modal, type ModalSection } from '../ui/Modal';

/**
 * What the project is and how it behaves, as against what is in it.
 *
 * Unity and Unreal both keep this with the project and in version control, and
 * both make packaging a section of it rather than a thing of its own. Only
 * settings that are read by something appear here: a control that does nothing
 * is a promise, and `forceWebGL` sat unread for several milestones.
 */

const SECTIONS: readonly ModalSection[] = [
  { id: 'project', label: 'Project', group: 'Project' },
  { id: 'rendering', label: 'Rendering', group: 'Engine' },
  { id: 'physics', label: 'Physics', group: 'Engine' },
];

const INPUT =
  'w-full rounded-xs border border-line-soft bg-surface-0 px-2 py-1 text-2xs text-ink outline-none focus:border-accent';

export function ProjectSettingsDialog({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((s) => s.project);
  const [section, setSection] = useState('project');
  const [draft, setDraft] = useState<ProjectSettings | null>(project?.settings ?? null);
  const [saving, setSaving] = useState(false);

  if (!project || !draft) return null;

  // Sections only. `loadingScene` is a single value, not a block to merge into.
  const patch = <K extends 'rendering' | 'physics'>(
    key: K,
    value: Partial<ProjectSettings[K]>,
  ) => setDraft({ ...draft, [key]: { ...draft[key], ...value } });

  const save = () => {
    setSaving(true);
    void window.studio.project
      // Only the sections this dialog edits. `build` is written by the export
      // as it runs, and sending a copy from when the dialog opened would undo
      // the folder it just remembered.
      .updateSettings({
        rendering: draft.rendering,
        physics: draft.physics,
        loadingScene: draft.loadingScene,
      })
      .then((saved) => {
        useProjectStore.getState().adoptProject(saved);
        // Named rather than implied: several of these only take effect on the
        // next renderer, and a change that silently does nothing until an
        // unrelated action reads as broken.
        notify({
          kind: 'success',
          title: 'Project settings saved',
          description: 'Backend and antialiasing apply when the editor restarts.',
        });
        onClose();
      })
      .catch((cause: unknown) => {
        notify({
          kind: 'error',
          title: 'Could not save the settings',
          description: cause instanceof Error ? cause.message : String(cause),
        });
      })
      .finally(() => setSaving(false));
  };

  return (
    <Modal
      title="Project Settings"
      sections={SECTIONS}
      activeSection={section}
      onSelectSection={setSection}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm px-3 py-1 text-2xs text-ink-muted hover:bg-surface-3 hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="rounded-sm bg-accent-dim px-3 py-1 text-2xs text-ink hover:bg-accent/40 disabled:opacity-50"
          >
            Save
          </button>
        </>
      }
    >
      {section === 'project' && (
        <section>
          <h3 className="mb-3 text-2xs font-medium text-ink">Project</h3>
          <Field label="Name">
            <p className="py-1 text-2xs text-ink">{project.name}</p>
          </Field>
          <Field label="Engine version">
            <p className="py-1 text-2xs text-ink-muted">{project.engineVersion}</p>
          </Field>
          <Field
            label="Scenes"
            hint="Every scene in the project. The start scene is the one a build opens on."
          >
            <div className="flex flex-col gap-px py-1">
              {project.scenes.map((scene) => (
                <label
                  key={scene.id}
                  className="flex cursor-pointer items-center gap-2 rounded-xs px-1 py-0.5 text-2xs text-ink hover:bg-surface-3"
                >
                  <input
                    type="radio"
                    name="startScene"
                    checked={scene.id === project.startScene}
                    // Written straight through rather than into the draft: it
                    // is a property of the project, not of its settings, and
                    // the registry is what keeps it pointing at a real scene.
                    onChange={() => void chooseStartScene(scene.id)}
                  />
                  <span className="flex-1">{scene.name}</span>
                  {/* The file, shown because it stops matching the name as soon
                      as a scene is renamed — and someone will go looking. */}
                  <span className="text-ink-muted">{scene.path}</span>
                </label>
              ))}
            </div>
          </Field>
          {/* The runtime has read this since loading screens existed; there has
              simply never been anywhere to set it. By name, as the runtime
              addresses scenes. */}
          <Field
            label="Loading scene"
            hint="Shown while another scene loads. It loads first, and the target loads behind it."
          >
            <select
              value={draft.loadingScene ?? ''}
              onChange={(event) =>
                setDraft({ ...draft, loadingScene: event.target.value || null })
              }
              className={INPUT}
            >
              <option value="">None — swap straight over</option>
              {project.scenes.map((scene) => (
                <option key={scene.id} value={scene.id}>
                  {scene.name}
                </option>
              ))}
            </select>
          </Field>
        </section>
      )}

      {section === 'rendering' && (
        <section>
          <h3 className="mb-3 text-2xs font-medium text-ink">Rendering</h3>

          <Field label="Force WebGL" hint="Applies on restart.">
            <input
              type="checkbox"
              checked={draft.rendering.forceWebGL}
              onChange={(event) => patch('rendering', { forceWebGL: event.target.checked })}
            />
          </Field>
          <Field label="Antialiasing" hint="Applies on restart.">
            <input
              type="checkbox"
              checked={draft.rendering.antialias}
              onChange={(event) => patch('rendering', { antialias: event.target.checked })}
            />
          </Field>
          <Field label="Shadows">
            <input
              type="checkbox"
              checked={draft.rendering.shadows}
              onChange={(event) => patch('rendering', { shadows: event.target.checked })}
            />
          </Field>
          <Field label="Shadow map size" hint="Per light. 4096 is four times the memory of 2048.">
            <select
              value={draft.rendering.shadowMapSize}
              onChange={(event) =>
                patch('rendering', { shadowMapSize: Number(event.target.value) })
              }
              className={INPUT}
            >
              {[512, 1024, 2048, 4096].map((size) => (
                <option key={size} value={size}>
                  {size} × {size}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Max pixel ratio"
            hint="The cheapest performance knob on a retina display."
          >
            <input
              type="number"
              min={1}
              max={3}
              step={0.5}
              value={draft.rendering.maxPixelRatio}
              onChange={(event) =>
                patch('rendering', { maxPixelRatio: Number(event.target.value) })
              }
              className={INPUT}
            />
          </Field>
          <Field label="Exposure">
            <input
              type="number"
              min={0}
              max={4}
              step={0.05}
              value={draft.rendering.exposure}
              onChange={(event) => patch('rendering', { exposure: Number(event.target.value) })}
              className={INPUT}
            />
          </Field>
        </section>
      )}

      {section === 'physics' && (
        <section>
          <h3 className="mb-3 text-2xs font-medium text-ink">Physics</h3>

          <Field label="Gravity" hint="Metres per second squared.">
            <div className="flex gap-1.5">
              {(['X', 'Y', 'Z'] as const).map((axis, index) => (
                <input
                  key={axis}
                  type="number"
                  step={0.1}
                  aria-label={`Gravity ${axis}`}
                  value={draft.physics.gravity[index]}
                  onChange={(event) => {
                    const gravity = [...draft.physics.gravity] as [number, number, number];
                    gravity[index] = Number(event.target.value);
                    patch('physics', { gravity });
                  }}
                  className={INPUT}
                />
              ))}
            </div>
          </Field>
          <Field
            label="Fixed timestep"
            hint="Seconds per solver step. Not the frame rate — the solver runs at this rate whatever the display does."
          >
            <select
              value={draft.physics.fixedTimestep}
              onChange={(event) =>
                patch('physics', { fixedTimestep: Number(event.target.value) })
              }
              className={INPUT}
            >
              {[
                [1 / 30, '30 Hz'],
                [1 / 50, '50 Hz'],
                [1 / 60, '60 Hz'],
                [1 / 120, '120 Hz'],
              ].map(([value, label]) => (
                <option key={label} value={value as number}>
                  {label as string}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Max substeps"
            hint="Ceiling per frame. Without one, a slow frame asks for more steps than fit in the next."
          >
            <input
              type="number"
              min={1}
              max={20}
              step={1}
              value={draft.physics.maxSubsteps}
              onChange={(event) => patch('physics', { maxSubsteps: Number(event.target.value) })}
              className={INPUT}
            />
          </Field>
        </section>
      )}
    </Modal>
  );
}
