import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCatalog } from '../src/pipeline/ingest.js'

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
