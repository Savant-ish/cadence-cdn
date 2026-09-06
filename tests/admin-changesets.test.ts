import test from 'node:test'
import assert from 'node:assert/strict'
import { readJson } from '../src/util/json.js'
import { mapLorcana, mapPokemon } from '../src/providers/tcgjson/mapper.js'
import {
  applyChangeSets,
  validateChangeSetFile,
} from '../src/admin/changesets.js'

const context = {
  release: {
    provider: 'tcgjson',
    id: 'fixture',
    manifestUrl: 'fixture://manifest',
    artifactUrl: 'fixture://catalog',
    artifactName: 'catalog.json',
  },
  importedAt: '2026-09-01T00:00:00.000Z',
}

test('applies approved bulk edits only to matching game records', async () => {
  const pokemon = await mapPokemon(
    await readJson('fixtures/tcgjson/pokemon.sample.json'),
    context,
  )
  const lorcana = await mapLorcana(
    await readJson('fixtures/tcgjson/lorcana.sample.json'),
    context,
  )
  const catalog = {
    games: [...pokemon.games, ...lorcana.games],
    sets: [...pokemon.sets, ...lorcana.sets],
    cards: [...pokemon.cards, ...lorcana.cards],
    printings: [...pokemon.printings, ...lorcana.printings],
  }
  const file = validateChangeSetFile({
    schemaVersion: 1,
    changeSets: [
      {
        id: 'classify-lorcana',
        title: 'Classify Lorcana',
        status: 'approved',
        reason: 'Reviewed in admin',
        createdBy: 'editor',
        createdAt: '2026-09-01T00:00:00Z',
        approvedBy: 'reviewer',
        approvedAt: '2026-09-02T00:00:00Z',
        operations: [
          {
            entity: 'set',
            select: { game: 'lorcana' },
            set: {
              'classification.eraId': 'chapter',
              'classification.eraName': 'Chapter Sets',
              'classification.kind': 'expansion',
            },
          },
        ],
      },
    ],
  })
  const report = applyChangeSets(catalog, file)
  assert.equal(report.matches, 1)
  assert.equal(lorcana.sets[0]?.classification?.eraId, 'chapter')
  assert.equal(
    pokemon.sets.some((set) => set.classification?.eraId === 'chapter'),
    false,
  )
})

test('skips drafts and rejects identity or approved sealed edits', async () => {
  const draft = validateChangeSetFile({
    schemaVersion: 1,
    changeSets: [
      {
        id: 'draft',
        title: 'Draft',
        status: 'draft',
        reason: 'Review needed',
        createdBy: 'editor',
        createdAt: '2026-09-01T00:00:00Z',
        operations: [
          {
            entity: 'card',
            select: { game: 'pokemon' },
            set: { cardType: 'Reviewed' },
          },
        ],
      },
    ],
  })
  const catalog = await mapPokemon(
    await readJson('fixtures/tcgjson/pokemon.sample.json'),
    context,
  )
  assert.equal(applyChangeSets(catalog, draft).skippedDrafts, 1)
  assert.throws(
    () =>
      validateChangeSetFile({
        schemaVersion: 1,
        changeSets: [
          {
            id: 'identity',
            title: 'Bad',
            status: 'draft',
            reason: 'Bad',
            createdBy: 'x',
            createdAt: 'x',
            operations: [
              {
                entity: 'set',
                select: { game: 'pokemon' },
                set: { id: 'changed' },
              },
            ],
          },
        ],
      }),
    /not editable/,
  )
  assert.throws(
    () =>
      validateChangeSetFile({
        schemaVersion: 1,
        changeSets: [
          {
            id: 'sealed',
            title: 'Too early',
            status: 'approved',
            reason: 'Bad',
            createdBy: 'x',
            createdAt: 'x',
            approvedBy: 'y',
            approvedAt: 'y',
            operations: [
              {
                entity: 'sealed-product',
                select: { game: 'pokemon' },
                set: { name: 'Box' },
              },
            ],
          },
        ],
      }),
    /cannot be approved/,
  )
  assert.throws(
    () =>
      validateChangeSetFile({
        schemaVersion: 1,
        changeSets: [
          {
            id: 'image',
            title: 'Bad URL',
            status: 'draft',
            reason: 'Bad',
            createdBy: 'x',
            createdAt: 'x',
            operations: [
              {
                entity: 'printing',
                select: { game: 'pokemon' },
                set: { 'image.sourceUrl': 'not-a-url' },
              },
            ],
          },
        ],
      }),
    /valid URL/,
  )
})
