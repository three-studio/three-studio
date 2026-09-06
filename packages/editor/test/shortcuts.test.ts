import { afterEach, describe, expect, it } from 'vitest';
import {
  applyShortcutOverrides,
  bindingForCommand,
  bindingOf,
  commandForBinding,
  formatBinding,
} from '../src/shell/shortcutBindings';
import { shortcutsApply } from '../src/shell/useShortcuts';

/** A key press, as the handler sees one. */
const press = (key: string, options: { mod?: boolean; shift?: boolean } = {}) => ({
  key,
  shiftKey: options.shift ?? false,
  metaKey: false,
  // Ctrl, not Cmd: `isMac` reads the bridge, and there is none in a test, so
  // the non-mac branch is the one these run against. It is also the one nobody
  // develops on, which makes it the one worth pinning.
  ctrlKey: options.mod ?? false,
});

/** The table is module state; a test that remaps has to put it back. */
afterEach(() => applyShortcutOverrides({}));

/*
 * Modifier shortcuts are resolved from the character a key produces, not from
 * its physical position. Matching on `event.code` shipped a bug where Cmd+Z did
 * nothing on an AZERTY keyboard, because the key labelled Z reports `KeyW`.
 */
describe('resolving a key to a command', () => {
  const commandFor = (key: string, options?: { mod?: boolean; shift?: boolean }) => {
    const binding = bindingOf(press(key, options));
    return binding === null ? null : commandForBinding(binding);
  };

  it('maps the documented shortcuts', () => {
    expect(commandFor('z', { mod: true })).toBe('undo');
    expect(commandFor('z', { mod: true, shift: true })).toBe('redo');
    expect(commandFor('y', { mod: true })).toBe('redo');
    expect(commandFor('d', { mod: true })).toBe('duplicate');
    expect(commandFor('s', { mod: true })).toBe('save');
    // Two keys for one gesture, which is why the table is keyed by binding.
    expect(commandFor('Delete')).toBe('delete');
    expect(commandFor('Backspace')).toBe('delete');
  });

  it('is case-insensitive, since Shift+Z reports an uppercase key', () => {
    expect(commandFor('Z', { mod: true, shift: true })).toBe('redo');
    expect(commandFor('S', { mod: true })).toBe('save');
  });

  it('ignores keys with no command, and bare letters entirely', () => {
    expect(commandFor('q', { mod: true })).toBeNull();
    expect(commandFor('Escape')).toBeNull();
    // A bare letter is a tool key, matched on physical position elsewhere and
    // deliberately not in this table.
    expect(bindingOf(press('d'))).toBeNull();
  });
});

describe('remapping', () => {
  it("lays the author's choice over the product's", () => {
    applyShortcutOverrides({ 'Mod+K': 'save' });
    expect(commandForBinding('Mod+K')).toBe('save');
    // The default is still there: an override adds to the table, it does not
    // replace it.
    expect(commandForBinding('Mod+S')).toBe('save');
  });

  it('frees a key with `null`, which is the only way to take one back', () => {
    applyShortcutOverrides({ 'Mod+S': null });
    expect(commandForBinding('Mod+S')).toBeNull();
  });

  it('drops a binding naming a command this build does not have', () => {
    // The file is hand-edited today, and a typo must cost a key rather than
    // throw inside a keydown handler.
    applyShortcutOverrides({ 'Mod+K': 'summonADragon' });
    expect(commandForBinding('Mod+K')).toBeNull();
  });
});

describe('what a menu shows', () => {
  it('formats a binding the way the platform writes it', () => {
    expect(formatBinding('Mod+Z')).toBe('Ctrl+Z');
    expect(formatBinding('Mod+Shift+Z')).toBe('Ctrl+Shift+Z');
  });

  it('finds the key for a command, so no menu types one by hand', () => {
    expect(bindingForCommand('undo')).toBe('Mod+Z');
    expect(bindingForCommand('duplicate')).toBe('Mod+D');
    // A command with no key: the menu shows no hint rather than an empty one.
    expect(bindingForCommand('newScene')).toBeNull();
  });
});

/*
 * Whether a shortcut is the editor's to act on. Two questions rather than one,
 * because the single question that used to be asked — "is the user typing" —
 * let Cmd+Z through an open dialog and undid an edit in the scene behind it.
 */
describe('shortcutsApply', () => {
  it('acts when the editor has the window to itself', () => {
    expect(shortcutsApply({ typing: false, covered: false })).toBe(true);
  });

  it('stands aside for a text field, with nothing open', () => {
    // Renaming an entity in the Inspector: Delete has to delete a character.
    expect(shortcutsApply({ typing: true, covered: false })).toBe(false);
  });

  it('stands aside for a surface on top, even with no text field under the key', () => {
    // The reported bug. Tweakpane commits a field and hands focus back to the
    // body, so the next Cmd+Z had no input under it — and a button in a dialog
    // never was one.
    expect(shortcutsApply({ typing: false, covered: true })).toBe(false);
  });

  it('needs both to be clear, not either', () => {
    expect(shortcutsApply({ typing: true, covered: true })).toBe(false);
  });
});
