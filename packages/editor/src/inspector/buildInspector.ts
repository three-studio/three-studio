import {
  componentsOf,
  findComponentById,
  linkedPhysicsMaterial,
  type AssetId,
  type ComponentDoc,
  type ComponentId,
  type CoreRegistries,
  type EntityDoc,
  type EntityId,
  type SceneDoc,
} from '@three-studio/core';
import type { FolderApi } from 'tweakpane';
import {
  renameEntity,
  setEntityVisible,
  setEnvironmentField,
  setLinkedMaterialField,
  setSkyField,
  setTransform,
} from '../commands/sceneCommands';
import { currentSceneName, renameCurrentScene } from '../commands/sceneFiles';
import { useAssetStore } from '../state/assetStore';
import { isSceneLocked } from '../state/sceneLock';
import { tunePhysicsMaterialField, tunedComponent, tunedPhysicsMaterial } from '../state/tuning';
import { assetFieldBundle, type AssetFieldActions } from './assetField';
import { PaneBinder, numeric, type FieldIO, type Holder } from './PaneBinder';
import {
  MultiTarget,
  SingleTarget,
  readPath,
  type ComponentTarget,
  type EntityTarget,
} from './target';
import { useDocumentStore } from '../state/documentStore';
import { expandedScene } from '../state/expansion';
import { inPrefabMode } from '../state/prefabModeStore';
import type { EditorRegistries } from '../registries';
import { paneEntriesFor, unknownTypesOn } from './panes';
import { SCENE_SCHEMA, isAction, isSeparator, sceneFieldPath, type FieldSpec } from './schema';
import { shapeOf } from './signature';

/**
 * What stands in for the rows of a component whose type no module of this
 * editor defines. Short lines: Tweakpane's text row does not wrap, and a line
 * wider than the Inspector's value column was cut off behind a scrollbar.
 */
const UNKNOWN_TYPE_NOTICE = 'Module not installed.\nKept with its entity,\nand saved as found.';

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

/**
 * What a pane is showing.
 *
 * The scene has no id because there is only ever one of it in a window: one
 * scene per window rather than tabs.
 */
export type InspectorTarget =
  | { kind: 'entity'; entityId: EntityId }
  /** Several, edited as one. `ids` are in selection order; the first decides the shape. */
  | { kind: 'entities'; ids: readonly EntityId[] }
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

  /**
   * @param registries The window's, which the expansion is read through and an
   *   action is handed.
   * @param actions What the asset slot cannot reach for itself; see
   *   `AssetFieldActions`. Handed down rather than imported, because the edge
   *   from a field control to the import store was an import cycle.
   */
  constructor(
    private readonly registries: EditorRegistries,
    container: HTMLElement,
    target: InspectorTarget,
    actions: AssetFieldActions,
  ) {
    this.binder = new PaneBinder(container, [assetFieldBundle(actions)]);

    if (target.kind === 'scene') {
      this.buildScene();
      return;
    }
    if (target.kind === 'entities') {
      this.buildMulti(target.ids);
      return;
    }
    const entity = currentEntity(registries, target.entityId);
    if (entity) this.build(entity);
  }

  refresh(): void {
    this.binder.refresh();
  }

  /** Every control greyed while the game runs; see `PaneBinder.setReadOnly`. */
  setReadOnly(readOnly: boolean): void {
    this.binder.setReadOnly(readOnly);
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
  private buildMulti(ids: readonly EntityId[]): void {
    const target = new MultiTarget(this.registries, ids);
    const folder = this.binder.pane.addFolder({ title: `${ids.length} objects selected` });
    folder.addBinding({ value: ids.length }, 'value', { label: 'Objects', readonly: true });

    const first = ids[0];
    if (first === undefined) return;
    for (const component of target.components()) {
      this.buildComponent(first, component, target);
    }
  }

  private build(entity: EntityDoc): void {
    this.buildHeader(entity);
    this.buildTransform(entity.id);

    // Through the target, so `buildComponent` does not know whether it is
    // editing one entity or forty: `buildMulti` hands it a `MultiTarget`.
    const target = new SingleTarget(this.registries, entity.id);
    for (const component of target.components()) {
      this.buildComponent(entity.id, component, target);
    }
    // What the entity carries of a type no module here defines: named, so that
    // the author knows it is there, and not editable, since nothing here can
    // read it. It goes with the entity, and a save writes it back as found.
    for (const type of unknownTypesOn(expandedScene(this.registries).scene, entity.id)) {
      this.binder.pane
        .addFolder({ title: type })
        .addBinding({ value: UNKNOWN_TYPE_NOTICE }, 'value', { label: 'Module', readonly: true, multiline: true, rows: 3 });
    }
  }

  /**
   * The scene's own properties, shown when nothing is selected.
   *
   * Every field here already had a command, a default and a binder path; the
   * panel is what was missing, so this is a table walk and nothing more.
   */
  private buildScene(): void {
    // In Prefab Mode the document is the prefab, and the pane is the prefab's.
    const subject = { environment: currentScene().environment, prefabOpen: inPrefabMode() };

    for (const section of SCENE_SCHEMA) {
      if (section.visibleWhen && !section.visibleWhen(subject)) continue;
      const folder = this.binder.pane.addFolder({ title: section.label });

      for (const spec of section.fields) {
        if (spec.visibleWhen && !spec.visibleWhen(subject)) continue;

        const path = sceneFieldPath(spec);
        const coalesceBase = `inspector:scene:${spec.on}:${spec.key}`;

        this.binder.bind(folder, { ...spec, path }, {
          read: () =>
            // A scene's name is its file name, not the label inside the
            // document — the file name is the name — so this one field reads the address.
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
        if (event.last) this.binder.edit(() => renameEntity(this.registries, entity.id, String(event.value)));
      });
    this.binder.track(name, () => currentEntity(this.registries, entity.id)?.name ?? '');

    const visible: Holder = { value: entity.visible };
    this.binder.pane
      .addBinding(visible, 'value', { label: 'Visible' })
      .on('change', (event) =>
        this.binder.edit(() => setEntityVisible(this.registries, entity.id, Boolean(event.value))),
      );
    this.binder.track(visible, () => currentEntity(this.registries, entity.id)?.visible ?? true);
  }

  private buildTransform(entityId: EntityId): void {
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
    entityId: EntityId,
    key: 'position' | 'rotation' | 'scale',
    label: string,
    scale: number,
  ): void {
    const read = () => {
      const transform = currentEntity(this.registries, entityId)?.transform[key] ?? [0, 0, 0];
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
            this.registries,
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
    entityId: EntityId,
    target: ComponentTarget,
    owner: EntityTarget,
  ): void {
    const component = target.representative;
    const componentId = component.id;
    const label = this.registries.components.get(component.type)?.label ?? component.type;
    const folder = this.binder.pane.addFolder({ title: label });

    // Conditional fields read the material the mesh actually renders with, so
    // a linked material shows the shared values' fields, not the embedded ones'.
    // And the rows are the tuned kind's during Play: a collider tuned to a
    // sphere shows a radius.
    const effective = effectiveComponent(entityId, component);
    // The same list `inspectorSignature` measures, from the same call: the shape
    // it decides to rebuild on has to be the shape this then builds.
    const { entries, live } = paneEntriesFor(this.registries, effective);
    for (const spec of entries) {
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
              registries: this.registries,
              entityId,
              componentId,
              component: currentComponent(this.registries, entityId, componentId) ?? component,
            }),
          );
        continue;
      }
      this.bindField(folder, entityId, target, spec, owner, live);
    }

    folder
      .addButton({ title: `Remove ${label}` })
      .on('click', () => this.binder.edit(() => target.remove()));
  }

  private bindField(
    folder: FolderApi,
    entityId: EntityId,
    target: ComponentTarget,
    spec: FieldSpec,
    owner: EntityTarget,
    live: boolean,
  ): void {
    const componentId = target.representative.id;
    const multiple = owner instanceof MultiTarget;
    const io: FieldIO = {
      read: () => {
        if (multiple) {
          // The first one's value. Tweakpane has no notion of an
          // undefined-but-present value, and handing it one is what makes it
          // throw "No matching controller", so there is nothing else to show.
          return target.read(spec.path);
        }
        const component = currentComponent(this.registries, entityId, componentId);
        return readPath(component && effectiveComponent(entityId, component), spec.path);
      },
      write: (value, { last, generation }) => {
        // During Play only a live row is enabled, and it tunes the running game:
        // the world takes the value, `state/tuning` keeps it, and the document
        // is not written. A linked collider's material rows tune the asset,
        // every collider linking it, as they edit its file when stopped.
        if (isSceneLocked()) {
          const component = currentComponent(this.registries, entityId, componentId);
          const linked =
            multiple || !component ? null : linkedMaterial(effectiveComponent(entityId, component), spec.path);
          const key = spec.path[1];
          this.binder.edit(() => {
            if (linked && component?.type === 'collider' && key !== undefined) {
              tunePhysicsMaterialField(linked.assetId, key, value);
            } else target.tune(spec.path, value);
          });
          return;
        }
        if (multiple) {
          // Straight to every target, in one entry: they share the coalesce key.
          this.binder.edit(() =>
            target.write(spec.path, value, {
              coalesceKey: `inspector:multi:${spec.path.join('.')}:${generation}`,
            }),
          );
          return;
        }
        const current = currentComponent(this.registries, entityId, componentId);
        const linked = linkedMaterial(current && effectiveComponent(entityId, current), spec.path);
        if (linked) {
          // The values belong to a shared asset, so the edit goes to the file
          // rather than to this entity — that is the whole point of linking.
          //
          // Only on `last`, which also makes the undo step exact: nothing is
          // written during the drag, so the stored material is still the value
          // the gesture started from.
          if (last) linked.edit(spec.label, spec.path[1]!, value);
          return;
        }
        this.binder.edit(() =>
          target.write(spec.path, value, {
            coalesceKey: `inspector:${entityId}:${componentId}:${spec.path.join('.')}:${generation}`,
          }),
        );
      },
    };
    this.binder.bind(folder, spec, io, live);
  }

}

/**
 * The document, not the expansion: the scene's own properties are the ones on
 * the file, and nothing a prefab produces can reach them.
 */
function currentScene(): SceneDoc {
  return useDocumentStore.getState().scene;
}

function currentEntity(registries: CoreRegistries, entityId: EntityId): EntityDoc | undefined {
  // The expanded scene, not the document. A prefab instance's contents are
  // drawn and selectable, but the document has never heard of their ids — read
  // from it alone and the panel goes blank for anything inside a prefab.
  return expandedScene(registries).scene.entities.get(entityId);
}

function currentComponent(
  registries: CoreRegistries,
  entityId: EntityId,
  componentId: ComponentId,
): ComponentDoc | undefined {
  return findComponentById(expandedScene(registries).scene, entityId, componentId);
}

/**
 * The component as it renders: a mesh linked to a material asset reports the
 * shared values, so the panel shows what is on screen rather than the embedded
 * copy it is no longer using. A collider linked to a physics material reports
 * the asset's values, which are what it is built with; one whose link the
 * project cannot answer reports its own, which are what it plays with.
 *
 * During Play, with what was tuned on it and on the asset it links: what the
 * running game is built with.
 */
export function effectiveComponent(entityId: EntityId, component: ComponentDoc): ComponentDoc {
  const { materials } = useAssetStore.getState();
  const tuned = tunedComponent(entityId, component);
  if (tuned.type === 'mesh' && tuned.materialId !== null) {
    const shared = materials.get(tuned.materialId);
    return shared ? { ...tuned, material: shared } : tuned;
  }
  if (tuned.type === 'collider' && tuned.materialId !== null) {
    const shared = tunedPhysicsMaterial(tuned.materialId);
    return shared ? { ...tuned, material: shared } : tuned;
  }
  return tuned;
}

/** A field whose edits go to a shared asset rather than to the document. */
export interface LinkedMaterial {
  assetId: AssetId;
  /** Writes one of the asset's values, as one undo step named after the field. */
  edit(label: string, key: string, value: unknown): void;
}

/** Non-null when this field edits a shared material rather than the document. */
export function linkedMaterial(
  component: ComponentDoc | undefined,
  path: readonly string[],
): LinkedMaterial | null {
  if (path[0] !== 'material' || path.length !== 2) return null;
  const { materials, physicsMaterials } = useAssetStore.getState();
  if (component?.type === 'mesh' && component.materialId !== null) {
    const assetId = component.materialId;
    const shared = materials.get(assetId);
    if (!shared) return null;
    return {
      assetId,
      edit: (label, key, value) =>
        setLinkedMaterialField('material', label, shared, { ...shared, [key]: value }, (material) =>
          useAssetStore.getState().saveMaterial(assetId, material),
        ),
    };
  }
  if (component?.type === 'collider' && component.materialId !== null) {
    const assetId = component.materialId;
    const shared = linkedPhysicsMaterial(assetId, physicsMaterials);
    if (!shared) return null;
    return {
      assetId,
      edit: (label, key, value) =>
        setLinkedMaterialField('physics material', label, shared, { ...shared, [key]: value }, (material) =>
          useAssetStore.getState().savePhysicsMaterial(assetId, material),
        ),
    };
  }
  return null;
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
export function inspectorSignature(registries: EditorRegistries, entityId: EntityId | undefined): string {
  const scene = expandedScene(registries).scene;
  if (entityId === undefined || !scene.entities.has(entityId)) return '';
  const parts = componentsOf(registries, scene, entityId).map((component) => {
    const effective = effectiveComponent(entityId, component);
    const { key, entries } = paneEntriesFor(registries, effective);
    return `${key}/${shapeOf(entries, effective)}`;
  });
  // Each of them is a folder, so the pane is rebuilt when one comes or goes.
  parts.push(...unknownTypesOn(scene, entityId).map((type) => `?${type}`));
  return `${entityId}|${parts.join(',')}`;
}
