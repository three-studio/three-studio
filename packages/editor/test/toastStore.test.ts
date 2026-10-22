import { beforeEach, describe, expect, it } from 'vitest';
import { toastSlot, useToastStore } from '../src/state/toastStore';

/*
 * One toast at a time for one subject. A failed Play pressed again, or a gesture
 * refused at each try, says the same thing twice: stacked, the copies say
 * nothing more than one and push everything else off the five the stack holds.
 * The second replaces the first where it stands — unless the person has closed
 * it, and then it is a new toast, since updating one nobody can see says
 * nothing at all.
 */

const toasts = () => useToastStore.getState().toasts;

beforeEach(() => {
  useToastStore.getState().clear();
});

describe('one toast at a time for one subject', () => {
  it('shows its toast', () => {
    const slot = toastSlot();

    slot.show({ kind: 'error', title: 'The game could not start' });

    expect(toasts().map((toast) => toast.title)).toEqual(['The game could not start']);
  });

  it('replaces its toast where it stands while it is up', () => {
    const slot = toastSlot();
    slot.show({ kind: 'error', title: 'Scripts did not compile' });
    const [first] = toasts();

    slot.show({ kind: 'error', title: 'The game could not start' });

    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]!.id).toBe(first!.id);
    expect(toasts()[0]!.title).toBe('The game could not start');
  });

  it('takes its toast away', () => {
    const slot = toastSlot();
    slot.show({ kind: 'error', title: 'Scripts did not compile' });

    slot.dismiss();

    expect(toasts()).toEqual([]);
  });

  it('shows a new toast once the person has closed it, or Clear all has', () => {
    const slot = toastSlot();
    slot.show({ kind: 'error', title: 'Scripts did not compile' });
    const closed = toasts()[0]!.id;
    useToastStore.getState().dismiss(closed);

    slot.show({ kind: 'error', title: 'Scripts did not compile' });

    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]!.id).not.toBe(closed);

    useToastStore.getState().clear();
    slot.show({ kind: 'error', title: 'Scripts did not compile' });

    expect(toasts()).toHaveLength(1);
  });

  it('leaves the toasts of another subject alone', () => {
    const play = toastSlot();
    const lock = toastSlot();
    play.show({ kind: 'error', title: 'Scripts did not compile' });
    lock.show({ kind: 'warning', title: 'Stop the game to edit the scene' });

    play.show({ kind: 'error', title: 'The game could not start' });
    lock.dismiss();

    expect(toasts().map((toast) => toast.title)).toEqual(['The game could not start']);
  });
});
