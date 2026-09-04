export const SCHEMA_VERSION = '1.1.0'
export const IDENTITY_VERSION = 'v1'

export interface CatalogGame {
  id: string
  identityKey: string
  slug: string
  name: string
}

export interface CatalogSet {
  id: string
  identityKey: string
  gameId: string
  code?: string
  name: string
  releaseDate?: string
  image?: {
    sourceUrl?: string
    status: 'reference-only' | 'licensed' | 'unavailable'
  }
}

export interface CatalogCard {
  id: string
  identityKey: string
  gameId: string
  name: string
  normalizedName: string
  cardType?: string
  metadata?: Record<string, unknown>
}

export interface CatalogProvenance {
  provider: string
  release: string
  sourceUrl?: string
  importedAt: string
}

export interface CatalogPrinting {
  id: string
  identityKey: string
  cardId: string
  setId: string
  collectorNumber?: string
  rarity?: string
  language: string
  finish?: string
  edition?: string
  image?: {
    sourceUrl?: string
    status: 'reference-only' | 'licensed' | 'unavailable'
  }
  externalIds: Record<string, string>
  provenance: CatalogProvenance
}

export interface NormalizedCatalog {
  games: CatalogGame[]
  sets: CatalogSet[]
  cards: CatalogCard[]
  printings: CatalogPrinting[]
}

export interface SourceRelease {
  provider: string
  id: string
  manifestUrl: string
  artifactUrl: string
  artifactName: string
  checksum?: { algorithm: 'sha256'; value: string }
  size?: number
}

export interface ImportContext {
  release: SourceRelease
  importedAt: string
}

export interface ValidationIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
}

export interface ValidationReport {
  valid: boolean
  counts: Record<'games' | 'sets' | 'cards' | 'printings', number>
  issues: ValidationIssue[]
}
