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
import { useScriptStore } from '../state/scriptStore';
import {
  COMPONENT_SCHEMAS,
  SCENE_SCHEMA,
  geometryFields,
  isAction,
  isGeometrySlot,
  isSeparator,
  sceneFieldPath,
  scriptFields,
  type FieldSpec,
  type GeometrySlotSpec,
  type PaneEntry,
} from './schema';

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
                // Renaming writes through the registry, which takes the start
                // scene, the build profiles and the loading scene with it.
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
    const schema = COMPONENT_SCHEMAS[component.type];
    const folder = this.binder.pane.addFolder({ title: schema.label });

    // Conditional fields read the material the mesh actually renders with, so
    // a linked material shows the shared values' fields, not the embedded ones'.
    const effective = effectiveComponent(component);
    // The geometry slot expands in place, so a component that never declares
    // one — every component except `mesh` — is unaffected.
    const specs: Exclude<PaneEntry, GeometrySlotSpec>[] = schema.fields.flatMap((entry) =>
      isGeometrySlot(entry) ? [...geometryFields(component)] : [entry],
    );
    specs.push(...scriptFields(component));

    for (const spec of specs) {
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
          // The value of the first, with the dash left to the label: Tweakpane
          // has no notion of an undefined-but-present value, and handing it one
          // is what makes it throw "No matching controller".
          return target.read(spec.path).value;
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
 */
export function inspectorSignature(entityId: string | undefined): string {
  const scene = expandedScene().scene;
  if (entityId === undefined || scene.entities[entityId] === undefined) return '';
  const parts = componentsOf(scene, entityId).map((component) => {
    // Conditional fields key off these, so they belong in the signature.
    switch (component.type) {
      // The kind decides which of a light's own properties exist, and the
      // shadow settings exist only while it casts one — so the checkbox is as
      // structural as the kind is. Without it in here, ticking "Cast shadows"
      // refreshed the pane's values and never added its rows.
      case 'light':
        return `light:${component.kind}:${component.castShadow}`;
      case 'camera':
        return `camera:${component.projection}`;
      case 'collider':
        return `collider:${component.shape}`;
      case 'mesh': {
        // Which map slots are filled decides whether their strength sliders
        // exist, so a slot going from empty to set has to rebuild the pane.
        // Linking to an asset swaps the buttons and the values read, so the
        // reference is in here too — read through `effectiveComponent`, or a
        // shared material's slots would never show their sliders.
        const mesh = effectiveComponent(component);
        const material = mesh.type === 'mesh' ? mesh.material : component.material;
        return `mesh:${component.geometry.kind}:${component.materialId ?? 'embedded'}:${
          material.normalMap === null ? '' : 'n'
        }${material.aoMap === null ? '' : 'a'}${material.displacementMap === null ? '' : 'd'}${
          material.bumpMap === null ? '' : 'b'
        }`;
      }
      // Linking a material swaps which rows the pane offers and where their
      // values are read from, and `nodePath` decides whether Unpack is there at
      // all — so both are as structural as a light's kind is.
      case 'model':
        return `model:${component.materialId ?? 'file'}:${component.nodePath === '' ? 'whole' : 'node'}`;
      case 'playerController':
        return `player:${component.mode}`;
      // Whether a source is positional decides whether it has falloff and a
      // cone at all, so the slider crossing zero is as structural as a light's
      // kind. Without this the rows were chosen once and never again: dragging
      // 2D ↔ 3D up from zero left the pane exactly as it was.
      case 'audioSource':
        return `audio:${component.spatialBlend > 0 ? '3d' : '2d'}`;
      // The chosen script decides which fields exist, so changing it has to
      // rebuild the pane. The build revision is in there too: editing a script
      // and recompiling changes which properties exist, and without it the
      // panel kept showing the previous set.
      case 'script':
        return `script:${component.assetId}:${useScriptStore.getState().revision}`;
      default:
        return component.type;
    }
  });
  return `${entityId}|${parts.join(',')}`;
}
