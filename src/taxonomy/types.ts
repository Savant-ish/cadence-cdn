export type PokemonSetKind =
  'expansion' | 'promo' | 'trainer-kit' | 'championship-deck' | 'supplemental'

export interface PokemonEra {
  id: string
  name: string
  startsOn?: string
}

export interface PokemonSetAssignment {
  setName: string
  eraId: string
  kind: PokemonSetKind
  status: 'pending' | 'approved'
  source: 'inferred' | 'curated'
  reviewedBy?: string
  reviewedAt?: string
  notes?: string
}

export interface PokemonTaxonomy {
  schemaVersion: 1
  game: 'pokemon'
  eras: PokemonEra[]
  assignments: Record<string, PokemonSetAssignment>
}

export interface TaxonomyReport {
  totalSets: number
  approved: number
  pending: number
  missing: number
  orphaned: number
  invalid: string[]
}
