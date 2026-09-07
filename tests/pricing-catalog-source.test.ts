import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fetchPublishedPrintings } from '../src/pricing/catalog-source.js'
import { sha256 } from '../src/util/json.js'

test('downloads only checksum-verified printings from the accepted catalog', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cadence-pricing-catalog-'))
  const bytes = Buffer.from('[{"id":"cadence:printing:test"}]\n')
  const base = 'https://cdn.example.test/catalog/builds/0123456789abcdef'
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/catalog/latest.json'))
      return Response.json({
        schemaVersion: '1.2.0',
        buildId: '0123456789abcdef',
        manifestUrl: `${base}/manifest.json`,
        catalogBaseUrl: base,
      })
    if (url.endsWith('/manifest.json'))
      return Response.json({
        schemaVersion: '1.2.0',
        buildId: '0123456789abcdef',
        artifacts: [
          {
            path: 'games/pokemon/printings.json',
            bytes: bytes.length,
            sha256: sha256(bytes),
          },
        ],
      })
    return new Response(bytes)
  }
  const output = join(root, 'printings.json')
  const metadata = join(root, 'catalog.json')
  const result = await fetchPublishedPrintings(
    {
      latestUrl: 'https://cdn.example.test/catalog/latest.json',
      game: 'pokemon',
      output,
      metadata,
    },
    fakeFetch,
  )
  assert.deepEqual(result, { buildId: '0123456789abcdef', printings: 1 })
  assert.deepEqual(await readFile(output), bytes)
  assert.equal(
    (JSON.parse(await readFile(metadata, 'utf8')) as { buildId: string })
      .buildId,
    '0123456789abcdef',
  )
})

test('rejects catalog artifact checksum mismatches', async () => {
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/latest.json'))
      return Response.json({
        schemaVersion: '1.2.0',
        buildId: '0123456789abcdef',
        manifestUrl: 'https://cdn.example.test/build/manifest.json',
        catalogBaseUrl: 'https://cdn.example.test/build',
      })
    if (url.endsWith('/manifest.json'))
      return Response.json({
        schemaVersion: '1.2.0',
        buildId: '0123456789abcdef',
        artifacts: [
          {
            path: 'games/pokemon/printings.json',
            bytes: 2,
            sha256: 'a'.repeat(64),
          },
        ],
      })
    return new Response('[]')
  }
  await assert.rejects(
    fetchPublishedPrintings(
      {
        latestUrl: 'https://cdn.example.test/latest.json',
        game: 'pokemon',
        output: 'unused.json',
        metadata: 'unused-meta.json',
      },
      fakeFetch,
    ),
    /checksum/,
  )
})
