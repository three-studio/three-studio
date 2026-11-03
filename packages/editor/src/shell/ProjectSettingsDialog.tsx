import {
  DEFAULT_LAYER_ID,
  MAX_COLLISION_LAYERS,
  createId,
  layerNamesProblem,
  layersTouch,
  setLayersTouch,
  type CollisionLayer,
  type ProjectSettings,
} from '@three-studio/core';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { commandById, contextForScene } from '../commands/registry';
import { isStartScene } from '../commands/sceneFiles';
import { notify } from '../state/toastStore';
import { useProjectStore } from '../state/projectStore';
import { Field, Modal, type ModalSection } from '../ui/Modal';
import { tooltip } from '../ui/Tooltip';

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
  const scenes = useProjectStore((s) => s.scenes);
  const [section, setSection] = useState('project');
  const [draft, setDraft] = useState<ProjectSettings | null>(project?.settings ?? null);
  const [saving, setSaving] = useState(false);

  if (!project || !draft) return null;

  // A Collider's Layer row lists the layers by name, so a table it could not
  // tell apart is not saved.
  const layersProblem = layerNamesProblem(draft.physics.layers);

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
            disabled={saving || layersProblem !== null}
            onClick={save}
            {...tooltip(layersProblem)}
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
              {scenes.map((scene) => (
                <label
                  key={scene.path}
                  className="flex cursor-pointer items-center gap-2 rounded-xs px-1 py-0.5 text-2xs text-ink hover:bg-surface-3"
                >
                  <input
                    type="radio"
                    name="startScene"
                    checked={isStartScene(scene, project.startScene)}
                    // Nothing can start on a file whose id another file already
                    // claims: the reference would resolve to that other one.
                    disabled={scene.shadowedBy !== null}
                    // Written straight through rather than into the draft: it
                    // is a property of the project, not of its settings.
                    onChange={() => commandById('setStartScene').run(contextForScene(scene.id))}
                  />
                  <span className="flex-1">{scene.name}</span>
                  {/* Keyed and labelled by path, because two files can now be
                      one scene as far as every reference is concerned, and the
                      path is the only thing that tells them apart. */}
                  <span className="text-ink-muted">{scene.path}</span>
                  {scene.shadowedBy !== null && (
                    <span className="text-warn" {...tooltip(`Same id as ${scene.shadowedBy}`)}>
                      duplicate id
                    </span>
                  )}
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
              {scenes
                // A shadowed file cannot be named: the id resolves to the one
                // that claimed it first.
                .filter((scene) => scene.shadowedBy === null)
                .map((scene) => (
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
          <Field
            label="Layers"
            hint="Every Collider starts on Default. Removing a layer puts its Colliders on Default."
            group
          >
            <LayerList
              layers={draft.physics.layers}
              problem={layersProblem}
              onChange={(layers) => patch('physics', { layers })}
            />
          </Field>
          <Field
            label="Collision matrix"
            hint="Ticked pairs touch. Unticked pairs pass through each other, and their sensors do not see each other."
            group
          >
            <CollisionMatrix
              layers={draft.physics.layers}
              onChange={(layers) => patch('physics', { layers })}
            />
          </Field>
        </section>
      )}
    </Modal>
  );
}

/** The layers in table order: Default as it is, every other one renamed or removed in place. */
function LayerList({
  layers,
  problem,
  onChange,
}: {
  layers: readonly CollisionLayer[];
  problem: string | null;
  onChange: (layers: CollisionLayer[]) => void;
}) {
  const full = layers.length >= MAX_COLLISION_LAYERS;
  return (
    <div className="flex flex-col gap-1">
      {layers.map((layer) =>
        layer.id === DEFAULT_LAYER_ID ? (
          // Every collider starts on it, and one whose layer is gone collides
          // as it: it can be neither renamed nor removed.
          <p key={layer.id} className="py-1 text-2xs text-ink">
            {layer.name}
          </p>
        ) : (
          <div key={layer.id} className="flex items-center gap-1.5">
            <input
              aria-label="Layer name"
              value={layer.name}
              onChange={(event) =>
                onChange(
                  layers.map((other) =>
                    other.id === layer.id ? { ...other, name: event.target.value } : other,
                  ),
                )
              }
              className={INPUT}
            />
            <button
              type="button"
              aria-label={`Remove ${layer.name}`}
              {...tooltip('Remove layer')}
              // What the others ignore of it goes when the table is saved.
              onClick={() => onChange(layers.filter((other) => other.id !== layer.id))}
              className="rounded-sm p-1 text-ink-dim hover:bg-surface-3 hover:text-error"
            >
              <Trash2 size={11} />
            </button>
          </div>
        ),
      )}
      {problem && <p className="text-2xs text-error">{problem}</p>}
      <button
        type="button"
        disabled={full}
        {...tooltip(full ? `A project holds ${MAX_COLLISION_LAYERS} layers at most` : undefined)}
        onClick={() =>
          onChange([...layers, { id: createId(), name: nextLayerName(layers), ignores: [] }])
        }
        className="flex items-center gap-1 self-start rounded-sm px-2 py-1 text-2xs text-ink-muted hover:bg-surface-3 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-muted"
      >
        <Plus size={11} />
        Add layer
      </button>
    </div>
  );
}

/** The first "Layer N" no layer is named, counting from 1. */
function nextLayerName(layers: readonly CollisionLayer[]): string {
  const names = new Set(layers.map((layer) => layer.name));
  let n = 1;
  while (names.has(`Layer ${n}`)) n += 1;
  return `Layer ${n}`;
}

/**
 * Unity's triangle: a row per layer in table order, a column per layer in
 * reverse, and a checkbox where the column's layer is not before the row's, so
 * each pair is shown once. Column names run upwards, so sixteen fit.
 */
function CollisionMatrix({
  layers,
  onChange,
}: {
  layers: readonly CollisionLayer[];
  onChange: (layers: CollisionLayer[]) => void;
}) {
  const columns = layers.map((layer, index) => ({ layer, index })).reverse();
  return (
    <table className="border-collapse text-2xs">
      <thead>
        <tr>
          <th />
          {columns.map(({ layer }) => (
            <th key={layer.id} scope="col" className="px-0.5 pb-1 align-bottom font-normal text-ink-muted">
              <span className="inline-block rotate-180 whitespace-nowrap [writing-mode:vertical-rl]">
                {layer.name}
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {layers.map((row, rowIndex) => (
          <tr key={row.id}>
            <th scope="row" className="whitespace-nowrap pr-2 text-right font-normal text-ink-muted">
              {row.name}
            </th>
            {columns.map(({ layer: column, index }) => (
              <td key={column.id} className="p-0.5 text-center">
                {index >= rowIndex && (
                  <input
                    type="checkbox"
                    aria-label={`${row.name} and ${column.name} touch`}
                    checked={layersTouch(layers, row.id, column.id)}
                    onChange={(event) =>
                      onChange(setLayersTouch(layers, row.id, column.id, event.target.checked))
                    }
                  />
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
