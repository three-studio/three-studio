import {
  componentsOf,
  findComponentById,
  type ComponentDoc,
  type EntityDoc,
  type MaterialDef,
  type SceneDoc,
} from '@three-studio/core';
import type { FolderApi } from 'tweakpane';
import {
  renameEntity,
  setComponentNestedField,
  setEntityVisible,
  setEnvironmentField,
  setLinkedMaterialField,
  setSkyField,
  setTransform,
} from '../commands/sceneCommands';
import { currentSceneName, renameCurrentScene } from '../commands/sceneFiles';
import { useAssetStore } from '../state/assetStore';
import { PaneBinder, numeric, type Holder } from './PaneBinder';
import {
  MultiTarget,
  SingleTarget,
  readPath,
  type ComponentTarget,
  type EntityTarget,
} from './target';
import { useDocumentStore } from '../state/documentStore';
import { expandedScene } from '../state/expansion';
import { COMPONENT_PANES, paneEntriesFor } from '../components/panes';
import { SCENE_SCHEMA, isAction, isSeparator, sceneFieldPath, type FieldSpec } from './schema';
import { shapeOf } from './signature';

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

/**
 * What a pane is showing.
 *
 * The scene has no id because there is only ever one of it in a window — see
 * ADR-12, which put one scene per window rather than tabs.
 */
export type InspectorTarget =
  | { kind: 'entity'; entityId: string }
  /** Several, edited as one. `ids` are in selection order; the first decides the shape. */
  | { kind: 'entities'; ids: readonly string[] }
  | { kind: 'scene' };

/**
 * A live Tweakpane inspector for one entity, or for the scene itself.
 *
 * `PaneBinder` holds the pane and the rows; this class knows only where a value
 * lives in the document and which command writes it back. `refresh()` pulls
 * current values back out, which is what keeps the panel correct while a gizmo
 * drag is moving the same entity.
 */
export class InspectorBinding {
  private readonly binder: PaneBinder;

  constructor(container: HTMLElement, target: InspectorTarget) {
    this.binder = new PaneBinder(container);

    if (target.kind === 'scene') {
      this.buildScene();
      return;
    }
    if (target.kind === 'entities') {
      this.buildMulti(target.ids);
      return;
    }
    const entity = currentEntity(target.entityId);
    if (entity) this.build(entity);
  }

  refresh(): void {
    this.binder.refresh();
  }

  dispose(): void {
    this.binder.dispose();
  }

  /**
   * Several entities at once.
   *
   * No header and no transform block: a name is per-entity, and a shared position
   * field would put forty objects on top of each other. Unity does the same — the
   * multiple-object inspector starts at the components.
   */
  private buildMulti(ids: readonly string[]): void {
    const target = new MultiTarget(ids);
    const folder = this.binder.pane.addFolder({ title: `${ids.length} objects selected` });
    folder.addBinding({ value: ids.length }, 'value', { label: 'Objects', readonly: true });

    for (const component of target.components()) {
      this.buildComponent(ids[0] ?? '', component, target);
    }
  }

  private build(entity: EntityDoc): void {
    this.buildHeader(entity);
    this.buildTransform(entity.id);

    // Through the target, so this loop does not know whether it is editing one
    // entity or forty. Phase 8 swaps in a `MultiTarget` and nothing here moves.
    const target = new SingleTarget(entity.id);
    for (const component of target.components()) {
      this.buildComponent(entity.id, component, target);
    }
  }

  /**
   * The scene's own properties, shown when nothing is selected.
   *
   * Every field here already had a command, a default and a binder path; the
   * panel is what was missing, so this is a table walk and nothing more.
   */
  private buildScene(): void {
    const scene = currentScene();

    for (const section of SCENE_SCHEMA) {
      if (section.visibleWhen && !section.visibleWhen(scene)) continue;
      const folder = this.binder.pane.addFolder({ title: section.label });

      for (const spec of section.fields) {
        if (spec.visibleWhen && !spec.visibleWhen(scene)) continue;

        const path = sceneFieldPath(spec);
        const coalesceBase = `inspector:scene:${spec.on}:${spec.key}`;

        this.binder.bind(folder, { ...spec, path }, {
          read: () =>
            // A scene's name is its file name, not the label inside the
            // document — ADR-14 — so this one field reads the address.
            spec.on === 'scene' ? currentSceneName() : readPath(currentScene(), path),
          write: (value, { last, generation }) => {
            switch (spec.on) {
              case 'scene':
                // Renaming moves the file and rewrites nothing else: the
                // start scene, the build profiles and the loading scene all
                // hold ids, and an id does not change when a name does.
                //
                // On blur rather than per keystroke: renaming once per letter
                // would leave a trail of scenes called `A`, `Ar`, `Are`.
                //
                // Refreshed afterwards either way. A refused rename — the name
                // is already taken — changes nothing in the document, so
                // nothing else would pull the field back off the name that was
                // typed, and the panel would go on showing a name no scene has.
                if (last) void renameCurrentScene(String(value)).then(() => this.refresh());
                return;
              case 'environment':
                this.binder.edit(() =>
                  setEnvironmentField(spec.key, value, {
                    coalesceKey: `${coalesceBase}:${generation}`,
                  }),
                );
                return;
              case 'sky':
                this.binder.edit(() =>
                  setSkyField(spec.key, value, {
                    coalesceKey: `${coalesceBase}:${generation}`,
                  }),
                );
                return;
            }
          },
        });
      }
    }
  }

  private buildHeader(entity: EntityDoc): void {
    const name: Holder = { value: entity.name };
    this.binder.pane
      .addBinding(name, 'value', { label: 'Name' })
      .on('change', (event) => {
        // Renaming commits on blur rather than per keystroke.
        if (event.last) this.binder.edit(() => renameEntity(entity.id, String(event.value)));
      });
    this.binder.track(name, () => currentEntity(entity.id)?.name ?? '');

    const visible: Holder = { value: entity.visible };
    this.binder.pane
      .addBinding(visible, 'value', { label: 'Visible' })
      .on('change', (event) => this.binder.edit(() => setEntityVisible(entity.id, Boolean(event.value))));
    this.binder.track(visible, () => currentEntity(entity.id)?.visible ?? true);
  }

  private buildTransform(entityId: string): void {
    const folder = this.binder.pane.addFolder({ title: 'Transform' });

    this.bindVector(folder, entityId, 'position', 'Position', 1);
    this.bindVector(folder, entityId, 'rotation', 'Rotation', RAD_TO_DEG);
    this.bindVector(folder, entityId, 'scale', 'Scale', 1);
  }

  /**
   * @param scale Factor applied on the way out; rotation is stored in radians
   *   and displayed in degrees.
   */
  private bindVector(
    folder: FolderApi,
    entityId: string,
    key: 'position' | 'rotation' | 'scale',
    label: string,
    scale: number,
  ): void {
    const read = () => {
      const transform = currentEntity(entityId)?.transform[key] ?? [0, 0, 0];
      return { x: transform[0] * scale, y: transform[1] * scale, z: transform[2] * scale };
    };

    const holder: Holder = { value: read() };
    folder
      // Through the same treatment as every other numeric field: a degree is
      // not an integer — 22.5° is an ordinary angle — and a position of 1.234
      // has to survive being typed.
      .addBinding(holder, 'value', {
        label,
        ...numeric({ step: key === 'rotation' ? 0.5 : 0.05 }),
      })
      .on('change', (event) => {
        if (this.binder.refreshing) return;

        const raw = event.value as { x: number; y: number; z: number };
        const inverse = key === 'rotation' ? DEG_TO_RAD : 1;
        this.binder.edit(() =>
          setTransform(
            entityId,
            { [key]: [raw.x * inverse, raw.y * inverse, raw.z * inverse] },
            { coalesceKey: `inspector:${entityId}:${key}:${this.binder.generation}` },
          ),
        );
        if (event.last) this.binder.endGesture();
      });

    this.binder.track(holder, read);
  }

  private buildComponent(
    entityId: string,
    target: ComponentTarget,
    owner: EntityTarget,
  ): void {
    const component = target.representative;
    const componentId = component.id;
    const schema = COMPONENT_PANES[component.type];
    const folder = this.binder.pane.addFolder({ title: schema.label });

    // Conditional fields read the material the mesh actually renders with, so
    // a linked material shows the shared values' fields, not the embedded ones'.
    const effective = effectiveComponent(component);
    // The same list `inspectorSignature` measures, from the same call: the shape
    // it decides to rebuild on has to be the shape this then builds.
    for (const spec of paneEntriesFor(component).entries) {
      if (isSeparator(spec)) {
        folder.addBlade({ view: 'separator' });
        continue;
      }
      if (spec.visibleWhen && !spec.visibleWhen(effective)) continue;
      if (isAction(spec)) {
        folder
          .addButton({ title: spec.title, label: spec.label ?? '' })
          .on('click', () =>
            spec.run({
              entityId,
              componentId,
              component: currentComponent(entityId, componentId) ?? component,
            }),
          );
        continue;
      }
      this.bindField(folder, entityId, target, spec, owner);
    }

    folder
      .addButton({ title: `Remove ${schema.label}` })
      .on('click', () => this.binder.edit(() => target.remove()));
  }

  private bindField(
    folder: FolderApi,
    entityId: string,
    target: ComponentTarget,
    spec: FieldSpec,
    owner: EntityTarget,
  ): void {
    const componentId = target.representative.id;
    const multiple = owner instanceof MultiTarget;
    this.binder.bind(folder, spec, {
      read: () => {
        if (multiple) {
          // The first one's value. Tweakpane has no notion of an
          // undefined-but-present value, and handing it one is what makes it
          // throw "No matching controller", so there is nothing else to show.
          return target.read(spec.path);
        }
        const component = currentComponent(entityId, componentId);
        return readPath(component && effectiveComponent(component), spec.path);
      },
      write: (value, { last, generation }) => {
        if (multiple) {
          // Straight to every target, in one entry: they share the coalesce key.
          this.binder.edit(() =>
            target.write(spec.path, value, {
              coalesceKey: `inspector:multi:${spec.path.join('.')}:${generation}`,
            }),
          );
          return;
        }
        const linked = linkedMaterial(currentComponent(entityId, componentId), spec.path);
        if (linked) {
          // The values belong to a shared asset, so the edit goes to the file
          // rather than to this entity — that is the whole point of linking.
          //
          // Only on `last`, which also makes the undo step exact: nothing is
          // written during the drag, so the stored material is still the value
          // the gesture started from.
          if (last) {
            setLinkedMaterialField(linked.assetId, spec.label, linked.material, {
              ...linked.material,
              [spec.path[1]!]: value,
            });
          }
          return;
        }
        this.binder.edit(() =>
          target.write(spec.path, value, {
            coalesceKey: `inspector:${entityId}:${componentId}:${spec.path.join('.')}:${generation}`,
          }),
        );
      },
    });
  }

}

/**
 * The document, not the expansion: the scene's own properties are the ones on
 * the file, and nothing a prefab produces can reach them.
 */
function currentScene(): SceneDoc {
  return useDocumentStore.getState().scene;
}

function currentEntity(entityId: string): EntityDoc | undefined {
  // The expanded scene, not the document. A prefab instance's contents are
  // drawn and selectable, but the document has never heard of their ids — read
  // from it alone and the panel goes blank for anything inside a prefab.
  return expandedScene().scene.entities[entityId];
}

function currentComponent(entityId: string, componentId: string): ComponentDoc | undefined {
  return findComponentById(expandedScene().scene, entityId, componentId);
}

/**
 * The component as it renders: a mesh linked to a material asset reports the
 * shared values, so the panel shows what is on screen rather than the embedded
 * copy it is no longer using.
 */
function effectiveComponent(component: ComponentDoc): ComponentDoc {
  if (component.type !== 'mesh' || component.materialId === null) return component;
  const shared = useAssetStore.getState().materials[component.materialId];
  return shared ? { ...component, material: shared } : component;
}

/** Non-null when this field edits a shared material rather than the document. */
function linkedMaterial(
  component: ComponentDoc | undefined,
  path: readonly string[],
): { assetId: string; material: MaterialDef } | null {
  if (path[0] !== 'material' || path.length !== 2) return null;
  if (component?.type !== 'mesh' || component.materialId === null) return null;
  const material = useAssetStore.getState().materials[component.materialId];
  return material ? { assetId: component.materialId, material } : null;
}

/**
 * Shape of an entity as far as the pane is concerned. When this changes the
 * pane must be rebuilt; when only values change, `refresh()` is enough.
 *
 * Derived, where it used to be a nine-armed switch that restated by hand every
 * `visibleWhen` in `schema.ts` and ended in `default: return component.type`.
 * A type whose structural field was not named in that switch never rebuilt its
 * panel at all: values refreshed, conditional rows never appeared. The two
 * copies had drifted twice by the time this replaced them — most visibly on a
 * `rectArea` light, whose `castShadow` is itself conditional, and which the
 * hand-written signature interpolated regardless.
 *
 * `effectiveComponent` is the subject for the same reason the builder uses it:
 * a mesh linked to a shared material shows the shared values' rows, so the
 * predicates have to be asked about the material actually on screen.
 */
export function inspectorSignature(entityId: string | undefined): string {
  const scene = expandedScene().scene;
  if (entityId === undefined || scene.entities[entityId] === undefined) return '';
  const parts = componentsOf(scene, entityId).map((component) => {
    const { key, entries } = paneEntriesFor(component);
    return `${key}/${shapeOf(entries, effectiveComponent(component))}`;
  });
  return `${entityId}|${parts.join(',')}`;
}
