import type {
  ImportContext,
  NormalizedCatalog,
  SourceRelease,
} from '../domain/catalog.js'

export interface CatalogProvider {
  readonly name: string
  resolveRelease(release?: string): Promise<SourceRelease>
  fetchGame(
    release: SourceRelease,
    game: string,
    destination: string,
  ): Promise<string>
  normalize(input: unknown, context: ImportContext): Promise<NormalizedCatalog>
}
