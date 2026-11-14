import type { Disposable } from './disposable';

/**
 * A table of definitions, filled by activation: component types, systems,
 * behaviours, importers.
 *
 * One class for all of them. Each had its own map, its own spelling of register,
 * look up and list, and three of them replaced a second registration in
 * silence, so which of two definitions of one id ran depended on the order a
 * bundler happened to evaluate modules in.
 *
 * Made by a composition root, or a test, and handed down: never a module's own,
 * which would make what is registered depend on what happens to be imported.
 */
export class Registry<Id extends string, Entry extends { readonly id: Id }> {
  private readonly entries = new Map<Id, Entry>();
  /**
   * The entries in registration order, as one array rebuilt on each change, so
   * a caller listing them per render or per file allocates nothing.
   */
  private listed: readonly Entry[] = [];

  /** `kind` names what it holds, for the refusal: `'component type'`, `'importer'`. */
  constructor(private readonly kind: string) {}

  /**
   * Files `entry` under its own id. Throws when the id is taken: two modules
   * claiming one id fail at start-up, by name, instead of the second winning.
   *
   * Disposing the result removes this entry, once. A registration disposed and
   * then disposed again does nothing, even if its id has been registered anew
   * meanwhile: what it removes is itself, never whatever sits under the id.
   */
  register(entry: Entry): Disposable {
    if (this.entries.has(entry.id)) {
      throw new Error(`The ${this.kind} "${entry.id}" is already registered.`);
    }
    this.entries.set(entry.id, entry);
    this.listed = [...this.entries.values()];

    let registered = true;
    return {
      dispose: () => {
        if (!registered) return;
        registered = false;
        this.entries.delete(entry.id);
        this.listed = [...this.entries.values()];
      },
    };
  }

  get(id: Id): Entry | undefined {
    return this.entries.get(id);
  }

  /** Registration order. The same array until the next registration or disposal. */
  values(): readonly Entry[] {
    return this.listed;
  }
}
