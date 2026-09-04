import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCatalog } from '../src/pipeline/ingest.js'
import { publicationBuildId } from '../src/pipeline/publish.js'

test('publishes byte-identical output for the same snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cadence-cdn-'))
  const first = join(root, 'first')
  const second = join(root, 'second')
  const options = {
    snapshot: 'fixtures/tcgjson/pokemon.sample.json',
    importedAt: '2026-09-01T00:00:00.000Z',
  }
  await buildCatalog({ ...options, output: first })
  await buildCatalog({ ...options, output: second })
  for (const relative of [
    'manifest.json',
    'games.json',
    'games/pokemon/sets.json',
    'games/pokemon/cards.json',
    'games/pokemon/printings.json',
  ]) {
    assert.deepEqual(
      await readFile(join(first, relative)),
      await readFile(join(second, relative)),
    )
  }
})

test('build identity covers schema, provenance, and operational output', () => {
  const descriptor = {
    schemaVersion: '1.2.0',
    identityVersion: 'v1',
    generatedAt: '2026-09-01T00:00:00.000Z',
    provider: {
      name: 'tcgjson',
      release: 'weekly-20260901',
      manifestUrl: 'https://example.test/manifest.json',
    },
    supportedGames: ['pokemon'],
    counts: { games: 1, sets: 1, cards: 1, printings: 1 },
    artifacts: [
      { path: 'games.json', bytes: 2, sha256: 'a'.repeat(64), records: 1 },
    ],
    operationalArtifacts: [
      { path: 'import-report.json', bytes: 2, sha256: 'b'.repeat(64) },
    ],
    validation: { valid: true, errors: 0, warnings: 0 },
    imagePolicy: 'reference-only' as const,
  }
  const original = publicationBuildId(descriptor)
  assert.notEqual(
    original,
    publicationBuildId({ ...descriptor, schemaVersion: '1.3.0' }),
  )
  assert.notEqual(
    original,
    publicationBuildId({
      ...descriptor,
      operationalArtifacts: [
        { path: 'import-report.json', bytes: 2, sha256: 'c'.repeat(64) },
      ],
    }),
  )
})
