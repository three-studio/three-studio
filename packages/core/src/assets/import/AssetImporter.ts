import { ASSET_META_SUFFIX, type AssetKind, type AssetSettings } from '../schema';
import type { ImportField } from './ImportField';

/**
 * Reads a file sitting next to the one being imported, relative to it.
 *
 * Injected rather than imported: `core` depends on nothing, and least of all on
 * `node:fs`. The main process hands in a reader backed by the filesystem; a
 * test hands in a map. It is what lets the knowledge of how an `.obj` names its
 * material library live in `ObjImporter` instead of in the Electron process.
 *
 * Resolves to `null` when there is no such file, which is not an error: a model
 * naming a texture that was never copied still imports.
 */
export type TextReader = (relativePath: string) => Promise<string | null>;

/**
 * One file format the editor knows how to bring into a project.
 *
 * Every question about a file that does not need the file's bytes is answered
 * here: whether we take it, where it lands, what settings it starts with, what
 * the import dialog should ask, and which side files must come along.
 *
 * Deliberately *not* here: hashing, copying and sidecar writing, which need the
 * disk, and probing and preview, which need three. Those live in the process
 * that can do them and find their importer by `id`, so there is still one
 * answer per format even though it takes three layers to give it.
 */
export abstract class AssetImporter<S extends AssetSettings = AssetSettings> {
  /** Stable across versions: it keys the layers that cannot live in `core`. */
  abstract readonly id: string;
  abstract readonly kind: AssetKind;
  /** Lowercase, no leading dot. */
  abstract readonly extensions: readonly string[];
  /** Where files of this kind land under `assets/` when nothing else is asked. */
  abstract readonly directory: string;

  /**
   * Double extensions, checked before `extensions`.
   *
   * A TSL material is a TypeScript module, so `.ts` alone cannot tell it from a
   * behaviour script — `.material.ts` can, and it reads clearly in a listing.
   */
  readonly suffixes: readonly string[] = [];

  /** Human name for the format, for the dialog's list. */
  get label(): string {
    return this.kind[0]!.toUpperCase() + this.kind.slice(1);
  }

  /**
   * Whether this importer takes the file.
   *
   * Order decides ties, and the registry's order is explicit — see
   * `ImporterRegistry`.
   */
  claims(fileName: string): boolean {
    const lower = fileName.toLowerCase();
    // A sidecar is bookkeeping, never an asset, whatever it ends in.
    if (lower.endsWith(ASSET_META_SUFFIX)) return false;
    if (this.suffixes.some((suffix) => lower.endsWith(suffix))) return true;
    return this.extensions.some((extension) => lower.endsWith(`.${extension}`));
  }

  /**
   * The settings a freshly imported file starts with.
   *
   * The one place a migration is allowed to fill from, which is why it takes
   * the file name: a field added later must be able to derive its value from
   * what the name says, or every stored sidecar needs a second list of defaults
   * kept in step with this one. See the format rules in `README.md`.
   */
  abstract defaultSettings(fileName: string): S;

  /** What the import dialog shows. Empty means "nothing to decide". */
  fields(_settings: S): readonly ImportField[] {
    return [];
  }

  /**
   * Side files this format references, relative to the file itself.
   *
   * A `.gltf` names its buffers and images; an `.obj` names a `.mtl` which
   * names its maps. Copying the model alone leaves an asset that opens to
   * nothing, which reads as a broken import.
   */
  companions(_fileName: string, _read: TextReader): Promise<readonly string[]> {
    return Promise.resolve([]);
  }
}
