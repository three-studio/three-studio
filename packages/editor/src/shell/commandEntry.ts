import {
  commandById,
  currentContext,
  type CommandId,
  type EditorContext,
} from '../commands/registry';
import { STOP_TO_EDIT } from '../state/sceneLock';
import type { MenuItem } from '../ui/Menu';
import { shortcutHint } from './shortcutBindings';

/**
 * A menu row from a command: its label, its key, its verdict and its body.
 *
 * The menu bar, the Add menu and the hierarchy's context menu each wrote these
 * four fields by hand, from the same registry: three copies of one translation,
 * and the Add menu's asked the command three times over, with no context, at
 * three different moments. Every menu row that runs a command is built here now.
 *
 * The context is read once and serves the label, the verdict and the body, so a
 * row cannot say one thing and do another. A caller with no context of its own
 * gets `currentContext()`, the selection as it stands, which is what the menu
 * bar builds in the same render.
 *
 * A `MenuItem` rather than a `MenuEntry`, so a caller can spread it and add what
 * only the caller knows, such as `checked`.
 */
export function commandEntry(id: CommandId, ctx?: EditorContext): MenuItem {
  const command = commandById(id);
  const context = ctx ?? currentContext();
  return {
    label: command.label(context),
    // The table's, not typed in here. `${modKey}Z` used to be written once in
    // the menu bar and once in the hierarchy, beside a third spelling in
    // `useShortcuts` that actually decided.
    shortcut: shortcutHint(id),
    disabled: !command.can(context),
    // Why a row is greyed when it is greyed only because the game runs: a menu
    // of greyed edits during Play otherwise reads as an editor that broke.
    detail: command.waitsForStop(context) ? STOP_TO_EDIT : undefined,
    onSelect: () => command.run(context),
  };
}
