import { access } from 'node:fs/promises'
import type { CatalogSet } from '../domain/catalog.js'
import { readJson, writeJson } from '../util/json.js'
import type {
  PokemonEra,
  PokemonSetAssignment,
  PokemonSetKind,
  PokemonTaxonomy,
  TaxonomyReport,
} from './types.js'

export const POKEMON_ERAS: PokemonEra[] = [
  { id: 'original', name: 'Original', startsOn: '1999-01-09' },
  { id: 'neo', name: 'Neo', startsOn: '2000-12-16' },
  { id: 'ecard', name: 'e-Card', startsOn: '2002-09-15' },
  { id: 'ex', name: 'EX', startsOn: '2003-06-18' },
  { id: 'diamond-and-pearl', name: 'Diamond & Pearl', startsOn: '2007-05-23' },
  { id: 'platinum', name: 'Platinum', startsOn: '2009-02-11' },
  {
    id: 'heartgold-soulsilver',
    name: 'HeartGold & SoulSilver',
    startsOn: '2010-02-10',
  },
  { id: 'black-and-white', name: 'Black & White', startsOn: '2011-04-25' },
  { id: 'xy', name: 'XY', startsOn: '2014-02-05' },
  { id: 'sun-and-moon', name: 'Sun & Moon', startsOn: '2017-02-03' },
  { id: 'sword-and-shield', name: 'Sword & Shield', startsOn: '2020-02-07' },
  {
    id: 'scarlet-and-violet',
    name: 'Scarlet & Violet',
    startsOn: '2023-03-31',
  },
  { id: 'mega-evolution', name: 'Mega Evolution', startsOn: '2025-09-26' },
  { id: 'unknown', name: 'Needs review' },
]

function suggestEra(releaseDate: string | undefined): string {
  if (!releaseDate) return 'unknown'
  return (
    [...POKEMON_ERAS]
      .filter((era) => era.startsOn && era.startsOn <= releaseDate)
      .sort((a, b) => b.startsOn!.localeCompare(a.startsOn!))[0]?.id ??
    'unknown'
  )
}

function suggestKind(name: string): PokemonSetKind {
  if (/world championship/i.test(name)) return 'championship-deck'
  if (/trainer kit/i.test(name)) return 'trainer-kit'
  if (/promo/i.test(name)) return 'promo'
  if (
    /deck|collection|exclusive|prize pack|miscellaneous|battle academy/i.test(
      name,
    )
  )
    return 'supplemental'
  return 'expansion'
}

function suggestedAssignment(set: CatalogSet): PokemonSetAssignment {
  return {
    setName: set.name,
    eraId: suggestEra(set.releaseDate),
    kind: suggestKind(set.name),
    status: 'pending',
    source: 'inferred',
  }
}

export async function loadTaxonomy(
  path: string,
): Promise<PokemonTaxonomy | undefined> {
  try {
    await access(path)
  } catch {
    return undefined
  }
  return (await readJson(path)) as PokemonTaxonomy
}

export async function updateSuggestions(
  sets: CatalogSet[],
  path: string,
): Promise<PokemonTaxonomy> {
  const existing = await loadTaxonomy(path)
  const assignments: Record<string, PokemonSetAssignment> = {}
  for (const set of [...sets].sort((a, b) => a.id.localeCompare(b.id))) {
    const prior = existing?.assignments[set.id]
    assignments[set.id] =
      prior?.status === 'approved' ? prior : suggestedAssignment(set)
  }
  const taxonomy: PokemonTaxonomy = {
    schemaVersion: 1,
    game: 'pokemon',
    eras: POKEMON_ERAS,
    assignments,
  }
  await writeJson(path, taxonomy)
  return taxonomy
}

export function applyApprovedTaxonomy(
  sets: CatalogSet[],
  taxonomy: PokemonTaxonomy | undefined,
): void {
  if (!taxonomy) return
  const eraNames = new Map(taxonomy.eras.map((era) => [era.id, era.name]))
  for (const set of sets) {
    const assignment = taxonomy.assignments[set.id]
    if (assignment?.status !== 'approved') continue
    const eraName = eraNames.get(assignment.eraId)
    if (!eraName) continue
    set.classification = {
      eraId: assignment.eraId,
      eraName,
      kind: assignment.kind,
    }
  }
}

export function taxonomyReport(
  sets: CatalogSet[],
  taxonomy: PokemonTaxonomy | undefined,
): TaxonomyReport {
  const setIds = new Set(sets.map((set) => set.id))
  const eraIds = new Set(taxonomy?.eras.map((era) => era.id) ?? [])
  const assignments = taxonomy?.assignments ?? {}
  const invalid: string[] = []
  let approved = 0
  let pending = 0
  let missing = 0
  for (const set of sets) {
    const assignment = assignments[set.id]
    if (!assignment) missing += 1
    else if (!eraIds.has(assignment.eraId))
      invalid.push(`${set.id} references unknown era ${assignment.eraId}`)
    else if (assignment.status === 'approved') approved += 1
    else pending += 1
  }
  return {
    totalSets: sets.length,
    approved,
    pending,
    missing,
    orphaned: Object.keys(assignments).filter((id) => !setIds.has(id)).length,
    invalid,
  }
}
