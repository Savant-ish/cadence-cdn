import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCatalog } from '../src/pipeline/ingest.js'
import {
  publishCatalogToStore,
  type ObjectStore,
} from '../src/pipeline/r2-publish.js'

class MemoryStore implements ObjectStore {
  readonly objects = new Map<
    string,
    { body: Buffer; sha256: string; cacheControl: string }
  >()

  async head(key: string): Promise<{ sha256?: string } | undefined> {
    const object = this.objects.get(key)
    return object ? { sha256: object.sha256 } : undefined
  }

  async put(
    key: string,
    body: Buffer,
    options: { contentType: string; cacheControl: string; sha256: string },
  ): Promise<void> {
    this.objects.set(key, {
      body,
      sha256: options.sha256,
      cacheControl: options.cacheControl,
    })
  }
}

test('publishes immutable objects before the mutable R2 pointer', async () => {
  const output = await mkdtemp(join(tmpdir(), 'cadence-r2-'))
  await buildCatalog({
    snapshot: 'fixtures/tcgjson/pokemon.sample.json',
    importedAt: '2026-09-01T00:00:00.000Z',
    output,
  })
  const store = new MemoryStore()
  const first = await publishCatalogToStore(
    output,
    'https://cdn.example.com/',
    store,
  )
  assert.ok(first.uploaded > 0)
  const latest = JSON.parse(
    store.objects.get('catalog/latest.json')!.body.toString(),
  ) as { buildId: string; manifestUrl: string }
  assert.equal(latest.buildId, first.buildId)
  assert.equal(
    latest.manifestUrl,
    `https://cdn.example.com/catalog/builds/${first.buildId}/manifest.json`,
  )
  assert.equal(
    store.objects.get('catalog/latest.json')!.cacheControl,
    'public, max-age=60, must-revalidate',
  )

  const second = await publishCatalogToStore(
    output,
    'https://cdn.example.com',
    store,
  )
  assert.equal(second.uploaded, 0)
  assert.equal(second.skipped, first.uploaded)
})

test('refuses to replace a conflicting immutable R2 object', async () => {
  const output = await mkdtemp(join(tmpdir(), 'cadence-r2-conflict-'))
  await buildCatalog({
    snapshot: 'fixtures/tcgjson/pokemon.sample.json',
    importedAt: '2026-09-01T00:00:00.000Z',
    output,
  })
  const store = new MemoryStore()
  const result = await publishCatalogToStore(
    output,
    'https://cdn.example.com',
    store,
  )
  const key = `catalog/builds/${result.buildId}/manifest.json`
  store.objects.get(key)!.sha256 = 'conflict'
  await assert.rejects(
    publishCatalogToStore(output, 'https://cdn.example.com', store),
    /Refusing to overwrite conflicting immutable object/,
  )
})
