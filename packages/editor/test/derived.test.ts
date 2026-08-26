import { describe, expect, it } from 'vitest';
import { derived } from '../src/state/derived';

/*
 * The memoisation primitive behind `expandedScene`.
 *
 * Two properties matter and neither is "it caches": the inputs are compared by
 * **identity**, which is what makes immer's structural sharing an exact
 * "nothing changed"; and the previous value is handed to the next computation,
 * which is what lets prefab expansion give back the entities an untouched
 * instance produced last time. Without the second, the binder would throw away
 * every geometry in the scene on each keystroke.
 */

describe('recomputing only when an input moved', () => {
  it('computes once for as many reads as you like', () => {
    let runs = 0;
    const input = { value: 1 };
    const source = derived(
      () => {
        runs += 1;
        return input.value;
      },
      () => [input],
    );

    expect(source.get()).toBe(1);
    expect(source.get()).toBe(1);
    expect(runs).toBe(1);
  });

  it('compares by identity, not by value', () => {
    let runs = 0;
    let input = { value: 1 };
    const source = derived(
      () => {
        runs += 1;
        return input.value;
      },
      () => [input],
    );

    source.get();
    // A mutation in place is invisible: that is the contract, and it holds
    // because the stores this reads never mutate — immer replaces.
    input.value = 2;
    expect(source.get()).toBe(1);

    input = { value: 2 };
    expect(source.get()).toBe(2);
    expect(runs).toBe(2);
  });

  it('hands the previous value to the next computation', () => {
    let inputs: readonly unknown[] = [1];
    const seen: (number | undefined)[] = [];
    const source = derived<number>(
      (previous) => {
        seen.push(previous);
        return (previous ?? 0) + 1;
      },
      () => inputs,
    );

    source.get();
    inputs = [2];
    source.get();

    // `undefined` the first time, then what the first pass produced — which is
    // how `expandPrefabs` reuses an untouched instance's contents.
    expect(seen).toEqual([undefined, 1]);
  });

  it('notices an input appearing or disappearing', () => {
    let inputs: readonly unknown[] = ['a'];
    let runs = 0;
    const source = derived(
      () => ++runs,
      () => inputs,
    );

    source.get();
    inputs = ['a', 'b'];
    source.get();
    expect(runs).toBe(2);
  });
});
