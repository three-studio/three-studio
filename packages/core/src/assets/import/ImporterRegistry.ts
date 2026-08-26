import type { AssetKind } from '../schema';
import type { AssetImporter } from './AssetImporter';

/**
 * Every format the editor can import, in the order they are asked.
 *
 * A chain of responsibility rather than a lookup table, because the question
 * "what is this file" has ties that a table cannot express: `.material.json`
 * and `.prefab.json` are both `.json`, and `.material.ts` is also `.ts`. The
 * previous version resolved those by whichever key `Object.entries` happened to
 * return first, which is a real answer arrived at by accident.
 */
export class ImporterRegistry {
  private readonly ordered: AssetImporter[] = [];

  register(...importers: readonly AssetImporter[]): this {
    this.ordered.push(...importers);
    return this;
  }

  /** The first importer that claims the file; `undefined` if none does. */
  resolve(fileName: string): AssetImporter | undefined {
    return this.ordered.find((importer) => importer.claims(fileName));
  }

  /**
   * The importer a kind falls back to when there is no file name to go on.
   *
   * `defaultSettings('model')` with nothing else has to answer something, and
   * the first registered importer of the kind is the honest choice — for models
   * that is glTF, which is the format to author against anyway.
   */
  forKind(kind: AssetKind): AssetImporter | undefined {
    return this.ordered.find((importer) => importer.kind === kind);
  }

  byId(id: string): AssetImporter | undefined {
    return this.ordered.find((importer) => importer.id === id);
  }

  all(): readonly AssetImporter[] {
    return this.ordered;
  }

  /** Every double extension any importer claims, longest first. */
  suffixes(): readonly string[] {
    return this.ordered
      .flatMap((importer) => importer.suffixes)
      .sort((a, b) => b.length - a.length);
  }
}
