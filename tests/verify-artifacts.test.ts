import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCatalog } from '../src/pipeline/ingest.js'
import { verifyPublishedArtifacts } from '../src/pipeline/verify-artifacts.js'

test('verifies all files declared by a publication manifest', async () => {
  const output = await mkdtemp(join(tmpdir(), 'cadence-verify-'))
  await buildCatalog({
    snapshot: 'fixtures/tcgjson/pokemon.sample.json',
    importedAt: '2026-09-01T00:00:00.000Z',
    output,
  })
  assert.ok(
    (await verifyPublishedArtifacts(join(output, 'manifest.json'), output)) > 0,
  )
})

test('rejects a modified published artifact', async () => {
  const output = await mkdtemp(join(tmpdir(), 'cadence-tamper-'))
  await buildCatalog({
    snapshot: 'fixtures/tcgjson/pokemon.sample.json',
    importedAt: '2026-09-01T00:00:00.000Z',
    output,
  })
  const path = join(output, 'games.json')
  await writeFile(path, `${await readFile(path, 'utf8')} `)
  await assert.rejects(
    verifyPublishedArtifacts(join(output, 'manifest.json'), output),
    /byte size mismatch/,
  )
})
