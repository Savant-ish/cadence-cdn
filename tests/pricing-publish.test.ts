import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ObjectStore } from '../src/pipeline/r2-publish.js'
import {
  packagePricingBatch,
  publishPricingToStore,
} from '../src/pricing/publish.js'
import { writeJson } from '../src/util/json.js'

class MemoryStore implements ObjectStore {
  objects = new Map<
    string,
    { body: Buffer; sha256: string; cacheControl: string }
  >()
  order: string[] = []
  async head(key: string) {
    const item = this.objects.get(key)
    return item ? { sha256: item.sha256 } : undefined
  }
  async put(
    key: string,
    body: Buffer,
    options: { sha256: string; cacheControl: string },
  ) {
    this.order.push(key)
    this.objects.set(key, {
      body,
      sha256: options.sha256,
      cacheControl: options.cacheControl,
    })
  }
  async verifyPublic(key: string, expected: { bytes: number; sha256: string }) {
    const item = this.objects.get(key)
    assert.equal(item?.body.length, expected.bytes)
    assert.equal(item?.sha256, expected.sha256)
  }
}

test('packages pricing into bounded chunks and publishes the pointer last', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cadence-pricing-publish-'))
  const input = join(root, 'batch.json')
  const output = join(root, 'dist')
  await writeJson(input, {
    schemaVersion: 1,
    provider: 'tcgcsv',
    externalIdKey: 'tcgplayer.productId',
    fetchedAt: '2026-09-07T20:05:41.000Z',
    catalogBuildId: 'catalog-1',
    currencyUnit: 'minor',
    observations: [1, 2, 3, 4, 5].map((number) => ({ id: `price:${number}` })),
    rejected: [{ providerProductId: 'x', reason: 'unknown-product' }],
  })
  const manifest = await packagePricingBatch({ input, output, chunkSize: 2 })
  assert.equal(
    manifest.artifacts.filter((item) => item.path.startsWith('observations/'))
      .length,
    3,
  )
  assert.equal(manifest.counts.observations, 5)
  const first = JSON.parse(
    await readFile(join(output, 'observations/00001.json'), 'utf8'),
  ) as unknown[]
  assert.equal(first.length, 2)
  const store = new MemoryStore()
  await publishPricingToStore(output, 'https://cdn.cadencetcg.dev', store)
  assert.equal(store.order.at(-1), 'pricing/latest.json')
  assert.ok(
    store.order
      .slice(0, -1)
      .every((key) => key.startsWith(`pricing/builds/${manifest.buildId}/`)),
  )
  const latest = JSON.parse(
    store.objects.get('pricing/latest.json')!.body.toString(),
  ) as { manifestUrl: string }
  assert.equal(
    latest.manifestUrl,
    `https://cdn.cadencetcg.dev/pricing/builds/${manifest.buildId}/manifest.json`,
  )
})
