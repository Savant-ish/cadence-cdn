import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { readdir, readFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { sha256, stableJson } from '../util/json.js'

interface CatalogManifest {
  schemaVersion: string
  buildId: string
  generatedAt: string
  provider: { release: string }
}

export interface R2PublicationOptions {
  root: string
  bucket: string
  accountId: string
  publicBaseUrl: string
  accessKeyId: string
  secretAccessKey: string
}

export interface ObjectStore {
  head(key: string): Promise<{ sha256?: string } | undefined>
  put(
    key: string,
    body: Buffer,
    options: { contentType: string; cacheControl: string; sha256: string },
  ): Promise<void>
}

async function filesUnder(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const paths = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name)
      return entry.isDirectory() ? filesUnder(root, path) : [path]
    }),
  )
  return paths.flat().sort()
}

function objectPath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/')
}

function normalizedBaseUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:')
    throw new Error('R2 public base URL must use HTTPS')
  return url.toString().replace(/\/$/, '')
}

export async function publishCatalogToStore(
  root: string,
  publicBaseUrl: string,
  store: ObjectStore,
): Promise<{ buildId: string; uploaded: number; skipped: number }> {
  const manifest = JSON.parse(
    await readFile(resolve(root, 'manifest.json'), 'utf8'),
  ) as CatalogManifest
  if (!/^[a-f0-9]{16}$/.test(manifest.buildId))
    throw new Error('Manifest contains an invalid build ID')

  const prefix = `catalog/builds/${manifest.buildId}`
  let uploaded = 0
  let skipped = 0
  for (const path of await filesUnder(root)) {
    const body = await readFile(path)
    const digest = sha256(body)
    const key = `${prefix}/${objectPath(root, path)}`
    const existing = await store.head(key)
    if (existing) {
      if (existing.sha256 !== digest)
        throw new Error(
          `Refusing to overwrite conflicting immutable object: ${key}`,
        )
      skipped += 1
      continue
    }
    await store.put(key, body, {
      contentType: 'application/json; charset=utf-8',
      cacheControl: 'public, max-age=31536000, immutable',
      sha256: digest,
    })
    const verified = await store.head(key)
    if (verified?.sha256 !== digest)
      throw new Error(`R2 upload verification failed: ${key}`)
    uploaded += 1
  }

  const baseUrl = normalizedBaseUrl(publicBaseUrl)
  const latest = Buffer.from(
    stableJson({
      schemaVersion: manifest.schemaVersion,
      buildId: manifest.buildId,
      generatedAt: manifest.generatedAt,
      providerRelease: manifest.provider.release,
      manifestUrl: `${baseUrl}/${prefix}/manifest.json`,
      catalogBaseUrl: `${baseUrl}/${prefix}`,
    }),
  )
  await store.put('catalog/latest.json', latest, {
    contentType: 'application/json; charset=utf-8',
    cacheControl: 'public, max-age=60, must-revalidate',
    sha256: sha256(latest),
  })
  return { buildId: manifest.buildId, uploaded, skipped }
}

export async function publishCatalogToR2(
  options: R2PublicationOptions,
): Promise<{ buildId: string; uploaded: number; skipped: number }> {
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${options.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
  })
  const store: ObjectStore = {
    async head(key) {
      try {
        const result = await client.send(
          new HeadObjectCommand({ Bucket: options.bucket, Key: key }),
        )
        return {
          ...(result.Metadata?.sha256
            ? { sha256: result.Metadata.sha256 }
            : {}),
        }
      } catch (error: unknown) {
        const status = (error as { $metadata?: { httpStatusCode?: number } })
          .$metadata?.httpStatusCode
        if (status === 404) return undefined
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
  }
  return publishCatalogToStore(
    resolve(options.root),
    options.publicBaseUrl,
    store,
  )
}
