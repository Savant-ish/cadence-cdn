import test from 'node:test'
import assert from 'node:assert/strict'
import { readJson } from '../src/util/json.js'
import { mapPokemon } from '../src/providers/tcgjson/mapper.js'

test('maps Pokemon while keeping cards distinct from printings', async () => {
  const input = await readJson('fixtures/tcgjson/pokemon.sample.json')
  const catalog = await mapPokemon(input, {
    release: {
      provider: 'tcgjson',
      id: 'weekly-20260901',
      manifestUrl: 'https://example.test/manifest',
      artifactUrl: 'https://example.test/pokemon.json',
      artifactName: 'pokemon.json',
    },
    importedAt: '2026-09-01T00:00:00.000Z',
  })
  assert.deepEqual(
    {
      games: catalog.games.length,
      sets: catalog.sets.length,
      cards: catalog.cards.length,
      printings: catalog.printings.length,
    },
    { games: 1, sets: 2, cards: 2, printings: 3 },
  )
  assert.equal(catalog.printings[0]?.image?.status === 'licensed', false)
  assert.ok(
    catalog.sets.every(
      (item) =>
        item.image?.status === 'reference-only' &&
        item.image.sourceUrl?.includes('/set_icon/'),
    ),
  )
  assert.ok(
    catalog.printings.every((item) => item.provenance.provider === 'tcgjson'),
  )
})
