/**
 * What gives back whatever it took: a registration, an activation.
 *
 * One method, so that whoever holds one can undo it without knowing what it
 * was. A registry hands one back for each entry it takes, and a layer's
 * activation hands back one for everything it registered.
 */
export interface Disposable {
  dispose(): void;
}

/**
 * One `Disposable` for several: disposes them last first, as a stack unwinds,
 * so what was put in on top of another comes out before it. Twice does nothing.
 *
 * Ours rather than TC39's `DisposableStack`: Safari and iOS Safari ship that in
 * no stable release, and the player and the device page run there.
 */
export function combineDisposables(disposables: readonly Disposable[]): Disposable {
  const held = [...disposables];
  return {
    dispose() {
      while (held.length > 0) held.pop()?.dispose();
    },
  };
}
