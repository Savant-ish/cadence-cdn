import test from 'node:test'
import assert from 'node:assert/strict'
import { readJson } from '../src/util/json.js'
import {
  isPokemonCodeCard,
  mapLorcana,
  mapPokemon,
} from '../src/providers/tcgjson/mapper.js'

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

test('maps Disney Lorcana as an independent game catalog', async () => {
  const input = await readJson('fixtures/tcgjson/lorcana.sample.json')
  const catalog = await mapLorcana(input, {
    release: {
      provider: 'tcgjson',
      id: 'fixture',
      manifestUrl: 'fixture://manifest',
      artifactUrl: 'fixture://lorcana',
      artifactName: 'lorcana.json',
    },
    importedAt: '2026-09-01T00:00:00.000Z',
  })
  assert.equal(catalog.games[0]?.slug, 'lorcana')
  assert.deepEqual(
    {
      sets: catalog.sets.length,
      cards: catalog.cards.length,
      printings: catalog.printings.length,
    },
    { sets: 1, cards: 2, printings: 2 },
  )
  assert.ok(catalog.cards.some((card) => card.cardType === 'Character'))
  assert.ok(
    catalog.printings.every((printing) =>
      printing.identityKey.includes('lorcana'),
    ),
  )
})

test('excludes Pokemon code-card products using narrow source signals', () => {
  assert.equal(
    isPokemonCodeCard({
      productId: 1,
      name: 'Code Card - Booster Pack',
    }),
    true,
  )
  assert.equal(
    isPokemonCodeCard({
      productId: 2,
      name: 'Upstream renamed digital product',
      metadata: { customAttributes: { rarityDbName: 'Code Card' } },
    }),
    true,
  )
  assert.equal(
    isPokemonCodeCard({
      productId: 3,
      name: 'Porygon',
      metadata: { flavorText: 'A Pokemon made of programming code.' },
    }),
    false,
  )
})

test('omits a source set containing only code-card products', async () => {
  const input = (await readJson('fixtures/tcgjson/pokemon.sample.json')) as any
  input.sets.push({ setId: 300, name: 'Digital-only group' })
  input.products.push({
    productId: 999,
    name: 'Code Card - Digital-only group',
    setId: 300,
    metadata: { customAttributes: { rarityDbName: 'Code Card' } },
  })
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
  assert.equal(
    catalog.sets.some((set) => set.name === 'Digital-only group'),
    false,
  )
  assert.equal(catalog.printings.length, 3)
})
