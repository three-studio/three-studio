import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hasOverlay, isTopOverlay, topOverlay, useOverlayStore } from '../src/state/overlayStore';

/*
 * The stack is what tells the editor's shortcuts that a key is not theirs. It
 * is small on purpose; what matters is that it stays honest about which surface
 * is on top, because that is who Escape belongs to.
 */

const surface = (id: string) => ({ id, kind: 'modal' as const, close: vi.fn() });

beforeEach(() => useOverlayStore.setState({ stack: [] }));

describe('the overlay stack', () => {
  it('is empty while the editor has the window to itself', () => {
    expect(hasOverlay()).toBe(false);
    expect(topOverlay()).toBeNull();
  });

  it('reports the surface that opened last', () => {
    const { open } = useOverlayStore.getState();
    open(surface('dialog'));
    open(surface('menu'));

    expect(topOverlay()?.id).toBe('menu');
    expect(hasOverlay()).toBe(true);
  });

  it('uncovers the one beneath when the top closes', () => {
    const { open, close } = useOverlayStore.getState();
    open(surface('dialog'));
    open(surface('menu'));
    close('menu');

    // A menu opened from inside a dialog closes alone. Both used to close,
    // because each had captured Escape on `document` for itself.
    expect(topOverlay()?.id).toBe('dialog');
  });

  it('removes one from the middle without disturbing the order', () => {
    const { open, close } = useOverlayStore.getState();
    open(surface('a'));
    open(surface('b'));
    open(surface('c'));
    close('b');

    expect(useOverlayStore.getState().stack.map((s) => s.id)).toEqual(['a', 'c']);
    expect(topOverlay()?.id).toBe('c');
  });

  it('ignores a close for something that is not open', () => {
    const { open, close } = useOverlayStore.getState();
    open(surface('dialog'));
    close('dialog');
    close('dialog');

    expect(useOverlayStore.getState().stack).toEqual([]);
  });

  it('replaces rather than stacks a second copy of one id', () => {
    // React mounts effects twice in development strict mode. Stacking would
    // leave a surface behind that no unmount can ever pop, and the editor would
    // stay deaf to its own shortcuts for the rest of the session.
    const { open } = useOverlayStore.getState();
    open(surface('dialog'));
    open(surface('dialog'));

    expect(useOverlayStore.getState().stack).toHaveLength(1);
  });
});

describe('whether a surface is on top', () => {
  it('is true for the one opened last', () => {
    const { open } = useOverlayStore.getState();
    open(surface('dialog'));
    open(surface('popover'));

    expect(isTopOverlay('popover')).toBe(true);
  });

  it('is false beneath another, and true again once that one closes', () => {
    // A popover that opened a prompt: a click in the prompt is not a click
    // away from the popover, which must stay open under it.
    const { open, close } = useOverlayStore.getState();
    open(surface('popover'));
    open(surface('prompt'));

    expect(isTopOverlay('popover')).toBe(false);

    close('prompt');

    expect(isTopOverlay('popover')).toBe(true);
  });

  it('is false for an id that was never opened', () => {
    useOverlayStore.getState().open(surface('dialog'));

    expect(isTopOverlay('nothing')).toBe(false);
  });
});
