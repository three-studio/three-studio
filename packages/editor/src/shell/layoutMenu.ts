import { askForText } from '../state/dialogStore';
import type { MenuEntry } from '../ui/Menu';
import { applyLayout, captureLayout } from './dockApi';
import { deleteTemplate, listTemplates, saveTemplate, type LayoutTemplate } from './layoutStorage';

export interface LayoutMenuActions {
  /** Rebuilds the built-in arrangement. */
  resetToDefault: () => void;
  /** Called after saving or deleting, so the menu redraws. */
  onChanged: () => void;
}

/**
 * The Layout menu: the built-in default, then whatever the user has saved.
 *
 * The default is not a stored template. It is rebuilt from code, so it keeps
 * working when panels are added or renamed in a later version, which a saved
 * copy of an old arrangement would not.
 */
export function buildLayoutMenu(actions: LayoutMenuActions): MenuEntry[] {
  const templates = listTemplates();

  const entries: MenuEntry[] = [
    { label: 'Default', onSelect: actions.resetToDefault },
  ];

  if (templates.length > 0) {
    entries.push(null);
    for (const template of templates) {
      entries.push({
        label: template.name,
        onSelect: () => applyTemplate(template, actions),
        onDelete: () => {
          deleteTemplate(template.id);
          actions.onChanged();
        },
      });
    }
  }

  entries.push(null, {
    label: 'Save Current Layout…',
    onSelect: () => void saveCurrentLayout(actions),
  });

  return entries;
}

function applyTemplate(template: LayoutTemplate, actions: LayoutMenuActions): void {
  // A template saved by an older build can name panels this one no longer has.
  // Falling back to the default beats leaving an empty window.
  if (!applyLayout(template.layout)) {
    console.error(`[layout] "${template.name}" could not be applied; restoring the default.`);
    actions.resetToDefault();
  }
}

async function saveCurrentLayout(actions: LayoutMenuActions): Promise<void> {
  const layout = captureLayout();
  if (!layout) return;

  const name = await askForText({
    title: 'Save Layout',
    label: 'Name',
    defaultValue: 'My Layout',
    confirmLabel: 'Save',
    validate: (value) =>
      value.trim().toLowerCase() === 'default'
        ? '"Default" is the built-in layout — pick another name.'
        : null,
  });
  if (name === null) return;

  // Saving over an existing name replaces it, which is what reusing a name
  // means; the list stays a set rather than accumulating duplicates.
  saveTemplate(name, layout);
  actions.onChanged();
}
