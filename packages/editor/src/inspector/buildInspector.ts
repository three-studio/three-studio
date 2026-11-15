import {
  componentsOf,
  findComponentById,
  isAssetId,
  type AssetId,
  type AssetKind,
  type ComponentDoc,
  type ComponentId,
  type CoreRegistries,
  type EntityDoc,
  type EntityId,
  type LinkedObject,
  type SceneDoc,
} from '@three-studio/core';
import { produce } from 'immer';
import type { FolderApi } from 'tweakpane';
import {
  renameEntity,
  setEntityVisible,
  setEnvironmentField,
  setLinkedAssetField,
  setSkyField,
  setTransform,
  writePath,
} from '../commands/sceneCommands';
import { currentSceneName, renameCurrentScene } from '../commands/sceneFiles';
import { saveAssetValues } from '../state/assetStore';
import { isSceneLocked } from '../state/sceneLock';
import { tunePhysicsMaterialField, tunedAssetValues, tunedComponent } from '../state/tuning';
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
                if (last) void renameCurrentScene(this.registries, String(value)).then(() => this.refresh());
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

    // Conditional rows read what is on screen: an object an asset fills shows
    // the rows of the asset's values, not of the component's own copy. And the
    // rows are the tuned kind's during Play: a collider tuned to a sphere shows
    // a radius.
    const effective = effectiveComponent(this.registries, entityId, component);
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
    /** The component as the game runs it during Play, as it is otherwise. */
    const current = (): ComponentDoc | undefined => {
      const component = currentComponent(this.registries, entityId, componentId);
      return component && tunedComponent(entityId, component);
    };
    /** The asset this row edits in place of the component, when its object is one an asset fills. */
    const linkedOf = (component: ComponentDoc | undefined): LinkedAsset | null =>
      component === undefined ? null : linkedAsset(this.registries, component, spec.path);
    const io: FieldIO = {
      read: () => {
        if (multiple) {
          // The first one's value. Tweakpane has no notion of an
          // undefined-but-present value, and handing it one is what makes it
          // throw "No matching controller", so there is nothing else to show.
          return target.read(spec.path);
        }
        const component = current();
        const linked = linkedOf(component);
        return linked ? readPath(linked.values, linked.path) : readPath(component, spec.path);
      },
      write: (value, { last, generation }) => {
        // During Play only a live row is enabled, and it tunes the running game:
        // the world takes the value, `state/tuning` keeps it, and the document
        // is not written. A row of an object an asset fills tunes the asset,
        // every component linking it, as it edits its file when stopped.
        if (isSceneLocked()) {
          const linked = multiple ? null : linkedOf(current());
          this.binder.edit(() => {
            if (linked) tunePhysicsMaterialField(linked.assetId, linked.path, value);
            else target.tune(spec.path, value);
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
        const linked = linkedOf(current());
        if (linked) {
          // The values belong to a shared asset, so the edit goes to the file
          // rather than to this entity — that is the whole point of linking.
          //
          // Only on `last`, which also makes the undo step exact: nothing is
          // written during the drag, so the stored asset is still the value
          // the gesture started from.
          if (last) editLinkedAsset(linked, spec.label, value);
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
 * The component as it is shown: during Play with what was tuned on it, and
 * each object an asset fills (`linkedBy`) holding that asset's values — what is
 * on screen, and what the running game is built with, rather than the
 * component's own copy, which it no longer uses. A link the project cannot
 * answer leaves the component's own values, which are what it draws or plays
 * with. The component itself, where nothing replaces anything.
 */
export function effectiveComponent(registries: CoreRegistries, entityId: EntityId, component: ComponentDoc): ComponentDoc {
  const tuned = tunedComponent(entityId, component);
  const filled = (registries.components.get(tuned.type)?.links ?? []).flatMap((link) => {
    const asset = assetOf(tuned, link);
    return asset === null ? [] : [{ object: link.object, values: asset.values }];
  });
  if (filled.length === 0) return tuned;
  return produce(tuned, (draft) => {
    for (const { object, values } of filled) writePath(draft, object, values);
  });
}

/** A row whose edits go to the asset its object is filled by, rather than to the document. */
export interface LinkedAsset {
  readonly kind: AssetKind;
  readonly assetId: AssetId;
  /** Where the row's value sits in the asset's values. */
  readonly path: readonly string[];
  /** The asset's values: the project's, or during Play as tuned. */
  readonly values: object;
  /** What an edit of it is called, « Edit material Roughness »: its object's label. */
  readonly noun: string;
}

/**
 * The asset a row at `path` edits: when the row lies under an object its type
 * links (`linkedBy`), and the asset field beside that object names an asset the
 * project holds. `null` for any other row, which edits the component.
 */
export function linkedAsset(
  registries: CoreRegistries,
  component: ComponentDoc,
  path: readonly string[],
): LinkedAsset | null {
  for (const link of registries.components.get(component.type)?.links ?? []) {
    const under = path.length > link.object.length && link.object.every((key, at) => path[at] === key);
    if (!under) continue;
    const asset = assetOf(component, link);
    if (asset === null) return null;
    return { kind: link.kind, ...asset, path: path.slice(link.object.length), noun: link.label.toLowerCase() };
  }
  return null;
}

/**
 * Writes one of a linked asset's values to its file, as one undo step named
 * after its object and the row. The document is not written: the values are
 * the asset's, and every component linking it shows them.
 */
export function editLinkedAsset(linked: LinkedAsset, label: string, value: unknown): void {
  const after = structuredClone(linked.values);
  writePath(after, linked.path, value);
  setLinkedAssetField(linked.noun, label, linked.values, after, (values) =>
    saveAssetValues(linked.kind, linked.assetId, values),
  );
}

/** The asset `link` names in `component`, with its values as the game runs them; `null` while it names none the project holds. */
function assetOf(
  component: ComponentDoc,
  link: LinkedObject,
): { readonly assetId: AssetId; readonly values: object } | null {
  const assetId = readPath(component, link.by);
  if (!isAssetId(assetId)) return null;
  const values = tunedAssetValues(link.kind, assetId);
  return values === null ? null : { assetId, values };
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
 * an object an asset fills shows the asset's values' rows, so the predicates
 * have to be asked about the values actually on screen.
 */
export function inspectorSignature(registries: EditorRegistries, entityId: EntityId | undefined): string {
  const scene = expandedScene(registries).scene;
  if (entityId === undefined || !scene.entities.has(entityId)) return '';
  const parts = componentsOf(registries, scene, entityId).map((component) => {
    const effective = effectiveComponent(registries, entityId, component);
    const { key, entries } = paneEntriesFor(registries, effective);
    return `${key}/${shapeOf(entries, effective)}`;
  });
  // Each of them is a folder, so the pane is rebuilt when one comes or goes.
  parts.push(...unknownTypesOn(scene, entityId).map((type) => `?${type}`));
  return `${entityId}|${parts.join(',')}`;
}
