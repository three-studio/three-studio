import { emptyShortcutPreferences, type ShortcutPreferences } from '@three-studio/core';
import { COMMANDS, type CommandId } from '../commands/registry';
import { hasModifier, isMac, modKey, shiftKey } from '../platform';

/*
 * Which key runs which command, as data.
 *
 * It used to be three separate spellings of one fact: a `switch` in
 * `useShortcuts` resolving a key to a command, a `shortcut` string on every
 * `Command` that **nothing read at all**, and the hint strings typed by hand
 * into each menu — `${modKey}Z` written once in the menu bar and once in the
 * hierarchy. A remap would have had to find all three, which is why nothing
 * remapped.
 *
 * Now there is one table, and both directions come out of it: the key handler
 * asks binding → command, and a menu asks command → binding and formats it.
 */

/**
 * A binding, written the way it is stored.
 *
 * `Mod` is the platform's primary modifier — Cmd on macOS, Ctrl elsewhere —
 * which is `hasModifier`'s question and not a second one. The key name is the
 * **character the key produces**, upper-cased, never its physical position:
 * matching on `event.code` shipped a bug where Cmd+Z did nothing on AZERTY,
 * because the key labelled Z reports `KeyW`. Users press the key they can read.
 *
 * The tool keys are the deliberate exception and are not in this table at all —
 * they match on position, so Q/W/E/R stay under the same fingers on every
 * layout, which is what Unity and Blender do. They are also not commands.
 */
export type ShortcutBinding = string;

/**
 * What the product binds out of the box.
 *
 * Keyed by binding so one command can answer to several keys — redo takes both
 * `Mod+Shift+Z` and `Mod+Y`, and delete both `Delete` and `Backspace`.
 */
export const DEFAULT_BINDINGS: Readonly<Record<ShortcutBinding, CommandId>> = {
  'Mod+Z': 'undo',
  'Mod+Shift+Z': 'redo',
  'Mod+Y': 'redo',
  'Mod+D': 'duplicate',
  'Mod+G': 'group',
  'Mod+S': 'save',
  Delete: 'delete',
  Backspace: 'delete',
};

/**
 * The author's overrides, laid over the defaults.
 *
 * Module state rather than a store: nothing re-renders on it, it is read inside
 * a `keydown` handler, and it changes once a session at most. `loadShortcuts`
 * fills it before the first render, the same way `layoutStorage` does.
 */
let overrides: Readonly<Record<ShortcutBinding, string | null>> = {};

/**
 * Puts a set of overrides in force.
 *
 * Separate from the load so the table can be exercised without a bridge — the
 * tests run in node, and the check that a remap actually takes effect must not
 * be a check that IPC works.
 */
export function applyShortcutOverrides(bindings: Readonly<Record<string, string | null>>): void {
  overrides = bindings;
}

/** Reads the saved overrides. Called once at startup, before anything renders. */
export async function loadShortcutBindings(): Promise<void> {
  applyShortcutOverrides((await window.studio.preferences.loadShortcuts()).bindings);
}

/**
 * Rebinds one key and writes it, or frees it when given `null`.
 *
 * There is no interface for this yet — see `RESTES.md`. It exists so that the
 * table is genuinely remappable rather than merely readable, and so the check
 * that a remap survives a restart has something to call.
 */
export async function rebind(binding: ShortcutBinding, command: CommandId | null): Promise<void> {
  applyShortcutOverrides({ ...overrides, [binding]: command });
  const preferences: ShortcutPreferences = {
    ...emptyShortcutPreferences(),
    bindings: overrides,
  };
  await window.studio.preferences.saveShortcuts(preferences);
}

/** Every binding in force: the defaults, with the author's laid over them. */
function effective(): Record<ShortcutBinding, string | null> {
  return { ...DEFAULT_BINDINGS, ...overrides };
}

/**
 * The binding a key press makes, or `null` for one this layer does not name.
 *
 * Shift is part of the binding only alongside the modifier: a bare Shift+D is
 * `D` as far as this is concerned, because the character *is* the shift.
 *
 * Structurally typed rather than taking a `KeyboardEvent`, for the reason
 * `hasModifier` is: React's synthetic events pass, and so does a plain object in
 * a test that has no DOM.
 */
export function bindingOf(event: {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}): ShortcutBinding | null {
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  if (hasModifier(event)) return `Mod+${event.shiftKey ? 'Shift+' : ''}${key}`;
  if (key === 'Delete' || key === 'Backspace') return key;
  return null;
}

/**
 * The command a binding runs, or `null` for one that runs nothing.
 *
 * An override naming a command this build does not have is dropped rather than
 * trusted: the file is hand-edited today, and a typo must cost a key rather than
 * a crash inside a `keydown` handler.
 */
export function commandForBinding(binding: ShortcutBinding): CommandId | null {
  const command = effective()[binding];
  if (typeof command !== 'string') return null;
  return command in COMMANDS ? (command as CommandId) : null;
}

/** The first binding that runs this command, or `null` when none does. */
export function bindingForCommand(id: CommandId): ShortcutBinding | null {
  for (const [binding, command] of Object.entries(effective())) {
    if (command === id) return binding;
  }
  return null;
}

/**
 * A binding as a menu shows it: `⌘⇧Z` on macOS, `Ctrl+Shift+Z` elsewhere.
 *
 * `⌫` for Backspace because that is what the key is engraved with on a Mac, and
 * what every Mac menu shows for it.
 */
export function formatBinding(binding: ShortcutBinding): string {
  if (binding === 'Backspace') return isMac ? '⌫' : 'Backspace';
  if (binding === 'Delete') return isMac ? '⌦' : 'Del';
  const withoutMod = binding.startsWith('Mod+') ? binding.slice('Mod+'.length) : binding;
  const shifted = withoutMod.startsWith('Shift+');
  const key = shifted ? withoutMod.slice('Shift+'.length) : withoutMod;
  return `${binding.startsWith('Mod+') ? modKey : ''}${shifted ? shiftKey : ''}${key}`;
}

/** What a menu puts beside a command, or `undefined` when it has no key. */
export function shortcutHint(id: CommandId): string | undefined {
  const binding = bindingForCommand(id);
  return binding === null ? undefined : formatBinding(binding);
}
