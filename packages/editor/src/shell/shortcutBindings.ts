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
 * The viewport keys are the deliberate exception and are not in this table at
 * all — Q/W/E/R for the tools and X for Global/Local match on position, so they
 * stay under the same fingers on every layout, which is what Unity and Blender
 * do. They are also not commands: none of them names a target.
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
  // What VS Code, Unity and Blender all put it on. `Mod+P` alone is "go to
  // file" in most of them, and this project has no files to go to.
  'Mod+Shift+P': 'openCommandPalette',
  /*
   * Ends a test, in the Viewport or full screen. Unreal stops Play on Esc,
   * and teams whose games use Esc for a menu move it to Shift+Esc, as Lyra
   * does. That is the key here from the start: plain Esc frees the mouse in the
   * panel, and in full screen it is the game's.
   */
  'Shift+Escape': 'stop',
  /*
   * Both keys delete, and their order is not cosmetic: `bindingForCommand`
   * returns the first, and that is the one a menu draws. A Mac keyboard's
   * delete key *is* Backspace and every Mac menu shows `⌫` for it; a PC has a
   * separate Del and shows that. The menus used to say this as
   * `isMac ? '⌫' : 'Del'` written into each of them by hand.
   */
  ...(isMac
    ? ({ Backspace: 'delete', Delete: 'delete' } as const)
    : ({ Delete: 'delete', Backspace: 'delete' } as const)),
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
 * `D` as far as this is concerned, because the character *is* the shift. Escape
 * has no shifted character, so Shift+Escape is a key of its own. Escape alone
 * is not a binding at all: it belongs to whatever is open on top, and then to
 * the selection (`useShortcuts`).
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
  if (key === 'Escape' && event.shiftKey) return 'Shift+Escape';
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
  // `Esc`, as the key is engraved, rather than the `⎋` glyph: the Viewport's
  // capture hint prints this inside a sentence, where a glyph few people know
  // is a riddle.
  const shown = key === 'Escape' ? 'Esc' : key;
  return `${binding.startsWith('Mod+') ? modKey : ''}${shifted ? shiftKey : ''}${shown}`;
}

/** What a menu puts beside a command, or `undefined` when it has no key. */
export function shortcutHint(id: CommandId): string | undefined {
  const binding = bindingForCommand(id);
  return binding === null ? undefined : formatBinding(binding);
}

/*
 * The positional keys, named as the keyboard in front of the author names them.
 *
 * The tool keys and X match on `event.code` — a key's place, named after the
 * letter a US keyboard prints there — so that they stay under the same fingers
 * on every layout (`useShortcuts`). Printing that name was right on a US
 * keyboard only: on AZERTY the Select tool's key is engraved A, and a tooltip
 * saying Q sent the author to a key that does nothing.
 *
 * Module state, like the overrides above, and for the same reasons.
 */
let keyboardLayout: ReadonlyMap<string, string> | null = null;

/** Puts a layout in force: what each key position types, keyed by `event.code`. */
export function applyKeyboardLayout(layout: ReadonlyMap<string, string> | null): void {
  keyboardLayout = layout;
}

/** The Keyboard API's one call, which the DOM's types do not carry. */
interface KeyboardLayoutSource {
  getLayoutMap(): Promise<ReadonlyMap<string, string>>;
}

/**
 * Reads what each key types on the keyboard in use. Called once at startup,
 * beside the bindings, so the first tooltip already says the right letter.
 *
 * Chromium answers in a secure context, which the dev server and a `file:`
 * page both are. Anything else — a browser without the API, a refusal — leaves
 * the US names, which are right on a US keyboard.
 */
export async function loadKeyboardLayout(): Promise<void> {
  const keyboard = (navigator as { keyboard?: KeyboardLayoutSource }).keyboard;
  if (keyboard === undefined) return;
  try {
    applyKeyboardLayout(await keyboard.getLayoutMap());
  } catch {
    // The US names stay.
  }
}

/**
 * A key named by its place, as its keycap shows it: `KeyQ` is `A` on AZERTY and
 * `Q` on QWERTY, and `Q` while the layout is unknown.
 */
export function positionalKeyLabel(code: string): string {
  const typed = keyboardLayout?.get(code);
  if (typed !== undefined && typed.length === 1) return typed.toUpperCase();
  return code.startsWith('Key') ? code.slice('Key'.length) : code;
}
