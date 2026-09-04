import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mapPokemon } from '../src/providers/tcgjson/mapper.js'
import { readJson, writeJson } from '../src/util/json.js'
import {
  applyApprovedTaxonomy,
  taxonomyReport,
  updateSuggestions,
} from '../src/taxonomy/pokemon.js'
import type { PokemonTaxonomy } from '../src/taxonomy/types.js'

async function fixtureSets() {
  const catalog = await mapPokemon(
    await readJson('fixtures/tcgjson/pokemon.sample.json'),
    {
      release: {
        provider: 'tcgjson',
        id: 'fixture',
        manifestUrl: 'fixture://manifest',
        artifactUrl: 'fixture://catalog',
        artifactName: 'catalog.json',
      },
      importedAt: '1970-01-01T00:00:00.000Z',
    },
  )
  return catalog.sets
}

test('suggestions remain pending and approved reviews survive refresh', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cadence-taxonomy-'))
  const path = join(root, 'pokemon.json')
  const sets = await fixtureSets()
  const initial = await updateSuggestions(sets, path)
  assert.deepEqual(taxonomyReport(sets, initial), {
    totalSets: 2,
    approved: 0,
    pending: 2,
    missing: 0,
    orphaned: 0,
    invalid: [],
  })

  const set = sets[0]!
  initial.assignments[set.id] = {
    ...initial.assignments[set.id]!,
    status: 'approved',
    source: 'curated',
    reviewedBy: 'admin',
    reviewedAt: '2026-09-04T00:00:00Z',
  }
  await writeJson(path, initial)
  const refreshed = await updateSuggestions(sets, path)
  assert.equal(refreshed.assignments[set.id]?.status, 'approved')
  applyApprovedTaxonomy(sets, refreshed)
  assert.ok(set.classification)
  assert.equal(
    sets.find((item) => item.id !== set.id)?.classification,
    undefined,
  )
})

test('reports assignments that reference unknown eras', async () => {
  const sets = await fixtureSets()
  const taxonomy: PokemonTaxonomy = {
    schemaVersion: 1,
    game: 'pokemon',
    eras: [],
    assignments: {
      [sets[0]!.id]: {
        setName: sets[0]!.name,
        eraId: 'not-real',
        kind: 'expansion',
        status: 'approved',
        source: 'curated',
      },
    },
  }
  assert.equal(taxonomyReport(sets, taxonomy).invalid.length, 1)
})
