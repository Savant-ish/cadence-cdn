import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import type { ObjectStore } from '../pipeline/r2-publish.js'
import { sha256, stableJson, writeJson } from '../util/json.js'
import type { PricingBatch } from './domain.js'

interface PricingArtifact {
  path: string
  bytes: number
  sha256: string
  records: number
}

export interface PricingManifest {
  schemaVersion: 1
  buildId: string
  generatedAt: string
  provider: string
  providerRelease: string
  catalogBuildId: string
  currencyUnit: 'minor'
  counts: { observations: number; rejected: number }
  artifacts: PricingArtifact[]
}

function buildId(value: Omit<PricingManifest, 'buildId'>): string {
  return createHash('sha256')
    .update(stableJson(value))
    .digest('hex')
    .slice(0, 16)
}

export async function packagePricingBatch(options: {
  input: string
  output: string
  chunkSize?: number
}): Promise<PricingManifest> {
  const batch = JSON.parse(
    await readFile(options.input, 'utf8'),
  ) as PricingBatch
  if (batch.schemaVersion !== 1 || !Array.isArray(batch.observations))
    throw new Error('Invalid normalized pricing batch')
  const chunkSize = options.chunkSize ?? 5_000
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1)
    throw new Error('Pricing chunk size must be a positive integer')
  await rm(options.output, { recursive: true, force: true })
  await mkdir(options.output, { recursive: true })
  const artifacts: PricingArtifact[] = []
  for (
    let offset = 0;
    offset < batch.observations.length;
    offset += chunkSize
  ) {
    const records = batch.observations.slice(offset, offset + chunkSize)
    const path = `observations/${String(offset / chunkSize + 1).padStart(5, '0')}.json`
    artifacts.push({
      path,
      ...(await writeJson(join(options.output, path), records)),
      records: records.length,
    })
  }
  artifacts.push({
    path: 'rejected.json',
    ...(await writeJson(join(options.output, 'rejected.json'), batch.rejected)),
    records: batch.rejected.length,
  })
  artifacts.sort((a, b) => a.path.localeCompare(b.path))
  const descriptor: Omit<PricingManifest, 'buildId'> = {
    schemaVersion: 1,
    generatedAt: batch.fetchedAt,
    provider: batch.provider,
    providerRelease: batch.fetchedAt,
    catalogBuildId: batch.catalogBuildId,
    currencyUnit: batch.currencyUnit,
    counts: {
      observations: batch.observations.length,
      rejected: batch.rejected.length,
    },
    artifacts,
  }
  const manifest = { ...descriptor, buildId: buildId(descriptor) }
  await writeJson(join(options.output, 'manifest.json'), manifest)
  return manifest
}

async function filesUnder(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = resolve(directory, entry.name)
        return entry.isDirectory() ? filesUnder(root, path) : [path]
      }),
    )
  )
    .flat()
    .sort()
}

function normalizedBaseUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:')
    throw new Error('R2 public base URL must use HTTPS')
  return url.toString().replace(/\/$/, '')
}

export async function publishPricingToStore(
  root: string,
  publicBaseUrl: string,
  store: ObjectStore,
): Promise<{ buildId: string; uploaded: number; skipped: number }> {
  const manifest = JSON.parse(
    await readFile(join(root, 'manifest.json'), 'utf8'),
  ) as PricingManifest
  if (!/^[a-f0-9]{16}$/.test(manifest.buildId))
    throw new Error('Pricing manifest has an invalid build ID')
  const prefix = `pricing/builds/${manifest.buildId}`
  const published: Array<{ key: string; bytes: number; sha256: string }> = []
  let uploaded = 0
  let skipped = 0
  for (const path of await filesUnder(root)) {
    const body = await readFile(path)
    const digest = sha256(body)
    const key = `${prefix}/${relative(root, path).split(sep).join('/')}`
    published.push({ key, bytes: body.length, sha256: digest })
    const existing = await store.head(key)
    if (existing) {
      if (existing.sha256 !== digest)
        throw new Error(
          `Refusing to overwrite conflicting immutable object: ${key}`,
        )
      skipped += 1
    } else {
      await store.put(key, body, {
        contentType: 'application/json; charset=utf-8',
        cacheControl: 'public, max-age=31536000, immutable',
        sha256: digest,
      })
      if ((await store.head(key))?.sha256 !== digest)
        throw new Error(`R2 upload verification failed: ${key}`)
      uploaded += 1
    }
  }
  for (const object of published) await store.verifyPublic?.(object.key, object)
  const base = normalizedBaseUrl(publicBaseUrl)
  const latest = Buffer.from(
    stableJson({
      schemaVersion: manifest.schemaVersion,
      buildId: manifest.buildId,
      generatedAt: manifest.generatedAt,
      provider: manifest.provider,
      providerRelease: manifest.providerRelease,
      catalogBuildId: manifest.catalogBuildId,
      manifestUrl: `${base}/${prefix}/manifest.json`,
      pricingBaseUrl: `${base}/${prefix}`,
    }),
  )
  await store.put('pricing/latest.json', latest, {
    contentType: 'application/json; charset=utf-8',
    cacheControl: 'public, max-age=60, must-revalidate',
    sha256: sha256(latest),
  })
  return { buildId: manifest.buildId, uploaded, skipped }
}

export async function publishPricingToR2(options: {
  root: string
  bucket: string
  accountId: string
  publicBaseUrl: string
  accessKeyId: string
  secretAccessKey: string
}): Promise<{ buildId: string; uploaded: number; skipped: number }> {
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${options.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
  })
  const base = normalizedBaseUrl(options.publicBaseUrl)
  const store: ObjectStore = {
    async head(key) {
      try {
        const result = await client.send(
          new HeadObjectCommand({ Bucket: options.bucket, Key: key }),
        )
        return result.Metadata?.sha256 ? { sha256: result.Metadata.sha256 } : {}
      } catch (error) {
        if (
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode === 404
        )
          return undefined
        throw error
      }
    },
    async put(key, body, metadata) {
      await client.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: key,
          Body: body,
          ContentType: metadata.contentType,
          CacheControl: metadata.cacheControl,
          Metadata: { sha256: metadata.sha256 },
        }),
      )
    },
    async verifyPublic(key, expected) {
      const response = await fetch(`${base}/${key}`, {
        signal: AbortSignal.timeout(120_000),
      })
      if (!response.ok)
        throw new Error(
          `Public pricing verification failed for ${key}: HTTP ${response.status}`,
        )
      const body = Buffer.from(await response.arrayBuffer())
      if (body.length !== expected.bytes || sha256(body) !== expected.sha256)
        throw new Error(`Public pricing verification mismatch: ${key}`)
    },
  }
  return publishPricingToStore(
    resolve(options.root),
    options.publicBaseUrl,
    store,
  )
}
