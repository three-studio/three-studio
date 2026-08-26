import { describe, expect, it } from 'vitest';
import { commandShortcut, shortcutsApply } from '../src/shell/useShortcuts';

/*
 * Modifier shortcuts are resolved from the character a key produces, not from
 * its physical position. Matching on `event.code` shipped a bug where Cmd+Z did
 * nothing on an AZERTY keyboard, because the key labelled Z reports `KeyW`.
 */
describe('commandShortcut', () => {
  it('maps the documented shortcuts', () => {
    expect(commandShortcut('z', false)).toBe('undo');
    expect(commandShortcut('z', true)).toBe('redo');
    expect(commandShortcut('y', false)).toBe('redo');
    expect(commandShortcut('d', false)).toBe('duplicate');
    expect(commandShortcut('s', false)).toBe('save');
  });

  it('is case-insensitive, since Shift+Z reports an uppercase key', () => {
    expect(commandShortcut('Z', true)).toBe('redo');
    expect(commandShortcut('S', false)).toBe('save');
  });

  it('ignores keys with no command', () => {
    expect(commandShortcut('q', false)).toBeNull();
    expect(commandShortcut('Escape', false)).toBeNull();
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
