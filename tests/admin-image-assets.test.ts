import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import {
  publishOwnedImage,
  type AssetObjectStore,
} from '../src/admin/image-assets.js'
import { sha256 } from '../src/util/json.js'

class MemoryStore implements AssetObjectStore {
  objects = new Map<
    string,
    { body: Buffer; sha256: string; cacheControl: string }
  >()
  verified: string[] = []
  async head(bucket: string, key: string) {
    const item = this.objects.get(`${bucket}/${key}`)
    return item ? { sha256: item.sha256 } : undefined
  }
  async put(
    bucket: string,
    key: string,
    body: Buffer,
    options: { cacheControl: string; sha256: string },
  ) {
    this.objects.set(`${bucket}/${key}`, {
      body,
      sha256: options.sha256,
      cacheControl: options.cacheControl,
    })
  }
  async verifyPublic(key: string, body: Buffer) {
    assert.equal(this.objects.get(`public/${key}`)?.sha256, sha256(body))
    this.verified.push(key)
  }
}

test('publishes private original and verified immutable derivatives with a draft', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cadence-assets-'))
  const registryPath = join(root, 'image-assets.json')
  const store = new MemoryStore()
  const bytes = await sharp({
    create: { width: 640, height: 900, channels: 3, background: '#336699' },
  })
    .png()
    .toBuffer()
  const result = await publishOwnedImage(
    {
      game: 'pokemon',
      entityType: 'printing',
      entityId: 'printing:test',
      filename: 'capture.png',
      bytes,
      source: 'Studio capture',
      creator: 'Cadence',
      capturedAt: '2026-09-06',
      rightsBasis: 'Owned original photograph',
      reviewedBy: 'admin',
    },
    {
      originalsBucket: 'originals',
      publicBucket: 'public',
      publicBaseUrl: 'https://assets.cadencetcg.dev',
      registryPath,
      store,
      now: () => new Date('2026-09-06T12:00:00Z'),
    },
  )
  assert.equal(store.objects.size, 3)
  assert.equal(store.verified.length, 2)
  assert.match(
    result.asset.derivatives.display.url,
    /^https:\/\/assets\.cadencetcg\.dev\/assets\/v1\/pokemon\/printing\//,
  )
  assert.equal(result.proposal.status, 'draft')
  assert.deepEqual(
    result.proposal.operations[0]?.set?.['image.status'],
    'licensed',
  )
  const registry = JSON.parse(await readFile(registryPath, 'utf8')) as {
    assets: unknown[]
  }
  assert.equal(registry.assets.length, 1)
  assert.equal(
    [...store.objects.values()].filter((item) =>
      item.cacheControl.includes('immutable'),
    ).length,
    2,
  )
})
