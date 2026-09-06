import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import sharp from 'sharp'
import { access } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { readJson, sha256, writeJson } from '../util/json.js'
import type { AdminEntityType, CatalogChangeSet } from './changesets.js'

export interface AssetObjectStore {
  head(bucket: string, key: string): Promise<{ sha256?: string } | undefined>
  put(
    bucket: string,
    key: string,
    body: Buffer,
    options: { contentType: string; cacheControl: string; sha256: string },
  ): Promise<void>
  verifyPublic(key: string, body: Buffer): Promise<void>
}

export interface ImageAssetRegistry {
  schemaVersion: 1
  assets: ImageAssetRecord[]
}

export interface ImageAssetRecord {
  id: string
  game: string
  entityType: 'set' | 'printing'
  entityId: string
  original: AssetFile & { filename: string }
  derivatives: {
    display: AssetFile & { url: string }
    thumbnail: AssetFile & { url: string }
  }
  rights: { source: string; creator: string; capturedAt: string; basis: string }
  approval: { reviewedBy: string; approvedAt: string }
  derivativeRecipe: string
  createdAt: string
}

interface AssetFile {
  key: string
  sha256: string
  bytes: number
  mimeType: string
  width?: number
  height?: number
}

export interface PublishImageInput {
  game: string
  entityType: AdminEntityType
  entityId: string
  filename: string
  bytes: Buffer
  source: string
  creator: string
  capturedAt: string
  rightsBasis: string
  reviewedBy: string
  approvedAt?: string
}

export interface ImageAssetOptions {
  originalsBucket: string
  publicBucket: string
  publicBaseUrl: string
  registryPath: string
  store: AssetObjectStore
  now?: () => Date
}

const recipe =
  'sharp-v1:auto-orient;display:webp,q88,max1600;thumbnail:webp,q82,max320'

function required(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} is required`)
  return value.trim()
}

function safe(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-|-$/g, '')
}

function baseUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:')
    throw new Error('Asset public base URL must use HTTPS')
  return url.toString().replace(/\/$/, '')
}

async function loadRegistry(path: string): Promise<ImageAssetRegistry> {
  try {
    await access(path)
  } catch {
    return { schemaVersion: 1, assets: [] }
  }
  const value = (await readJson(path)) as ImageAssetRegistry
  if (value.schemaVersion !== 1 || !Array.isArray(value.assets))
    throw new Error('Invalid image asset registry')
  return value
}

async function immutablePut(
  store: AssetObjectStore,
  bucket: string,
  file: AssetFile,
  body: Buffer,
  cacheControl: string,
): Promise<void> {
  const existing = await store.head(bucket, file.key)
  if (existing) {
    if (existing.sha256 !== file.sha256)
      throw new Error(
        `Refusing to overwrite conflicting immutable object: ${file.key}`,
      )
    return
  }
  await store.put(bucket, file.key, body, {
    contentType: file.mimeType,
    cacheControl,
    sha256: file.sha256,
  })
  const verified = await store.head(bucket, file.key)
  if (verified?.sha256 !== file.sha256)
    throw new Error(`R2 upload verification failed: ${file.key}`)
}

export async function publishOwnedImage(
  input: PublishImageInput,
  options: ImageAssetOptions,
): Promise<{ asset: ImageAssetRecord; proposal: CatalogChangeSet }> {
  if (!['set', 'printing'].includes(input.entityType))
    throw new Error('Owned images can only target a set or printing')
  if (!input.bytes.length || input.bytes.length > 30_000_000)
    throw new Error('Image must be between 1 byte and 30 MB')
  const source = required(input.source, 'Source')
  const creator = required(input.creator, 'Creator')
  const capturedAt = required(input.capturedAt, 'Capture date')
  const basis = required(input.rightsBasis, 'Rights basis')
  const reviewedBy = required(input.reviewedBy, 'Reviewer')
  const entityId = required(input.entityId, 'Entity ID')
  const game = safe(required(input.game, 'Game'))
  const entityType = input.entityType as 'set' | 'printing'
  const originalMetadata = await sharp(input.bytes).metadata()
  if (!['jpeg', 'png', 'webp', 'avif'].includes(originalMetadata.format ?? ''))
    throw new Error('Only JPEG, PNG, WebP, and AVIF images are supported')
  const display = await sharp(input.bytes)
    .rotate()
    .resize({
      width: 1600,
      height: 1600,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 88 })
    .toBuffer({ resolveWithObject: true })
  const thumbnail = await sharp(input.bytes)
    .rotate()
    .resize({
      width: 320,
      height: 320,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true })
  const originalDigest = sha256(input.bytes)
  const identity = `${game}/${entityType}/${safe(entityId)}/${originalDigest}`
  const publicRoot = `assets/v1/${identity}`
  const publicUrl = baseUrl(options.publicBaseUrl)
  const original: ImageAssetRecord['original'] = {
    key: `originals/v1/${originalDigest}/${safe(basename(input.filename)) || 'image'}`,
    filename: basename(input.filename),
    sha256: originalDigest,
    bytes: input.bytes.length,
    mimeType: `image/${originalMetadata.format === 'jpeg' ? 'jpeg' : originalMetadata.format}`,
    ...(originalMetadata.width ? { width: originalMetadata.width } : {}),
    ...(originalMetadata.height ? { height: originalMetadata.height } : {}),
  }
  const makeDerivative = (
    name: 'display' | 'thumbnail',
    output: typeof display,
  ): AssetFile & { url: string } => {
    const key = `${publicRoot}/${name}.webp`
    return {
      key,
      url: `${publicUrl}/${key}`,
      sha256: sha256(output.data),
      bytes: output.data.length,
      mimeType: 'image/webp',
      width: output.info.width,
      height: output.info.height,
    }
  }
  const derivatives = {
    display: makeDerivative('display', display),
    thumbnail: makeDerivative('thumbnail', thumbnail),
  }
  await immutablePut(
    options.store,
    options.originalsBucket,
    original,
    input.bytes,
    'private, no-store',
  )
  await immutablePut(
    options.store,
    options.publicBucket,
    derivatives.display,
    display.data,
    'public, max-age=31536000, immutable',
  )
  await immutablePut(
    options.store,
    options.publicBucket,
    derivatives.thumbnail,
    thumbnail.data,
    'public, max-age=31536000, immutable',
  )
  await options.store.verifyPublic(derivatives.display.key, display.data)
  await options.store.verifyPublic(derivatives.thumbnail.key, thumbnail.data)
  const now = (options.now ?? (() => new Date()))().toISOString()
  const asset: ImageAssetRecord = {
    id: `asset-${sha256(`${game}:${entityType}:${entityId}:${originalDigest}`).slice(0, 20)}`,
    game,
    entityType,
    entityId,
    original,
    derivatives,
    rights: { source, creator, capturedAt, basis },
    approval: { reviewedBy, approvedAt: input.approvedAt ?? now },
    derivativeRecipe: recipe,
    createdAt: now,
  }
  const registry = await loadRegistry(options.registryPath)
  if (
    !registry.assets.some(
      (item) => item.id === asset.id && item.entityId === entityId,
    )
  ) {
    registry.assets.push(asset)
    await writeJson(options.registryPath, registry)
  }
  const proposal: CatalogChangeSet = {
    id: `owned-image-${safe(entityId)}-${originalDigest.slice(0, 12)}`,
    title: `Use approved owned image for ${entityId}`,
    status: 'draft',
    reason: `Replace provider image reference with approved asset ${asset.id}`,
    createdBy: reviewedBy,
    createdAt: now,
    operations: [
      {
        entity: entityType,
        select: { game, ids: [entityId] },
        set: {
          'image.sourceUrl': derivatives.display.url,
          'image.status': 'licensed',
        },
      },
    ],
  }
  return { asset, proposal }
}

export function createR2AssetStore(config: {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  publicBaseUrl: string
}): AssetObjectStore {
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
  const publicUrl = baseUrl(config.publicBaseUrl)
  return {
    async head(bucket, key) {
      try {
        const result = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
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
    async put(bucket, key, body, metadata) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: metadata.contentType,
          CacheControl: metadata.cacheControl,
          Metadata: { sha256: metadata.sha256 },
        }),
      )
    },
    async verifyPublic(key, expected) {
      const response = await fetch(`${publicUrl}/${key}`, {
        signal: AbortSignal.timeout(120_000),
      })
      if (!response.ok)
        throw new Error(
          `Public asset verification failed: HTTP ${response.status}`,
        )
      const actual = Buffer.from(await response.arrayBuffer())
      if (sha256(actual) !== sha256(expected))
        throw new Error(`Public asset hash mismatch: ${key}`)
    },
  }
}

export function imageAssetOptionsFromEnv(workspace: string): ImageAssetOptions {
  const get = (name: string, fallback?: string) => {
    const value = process.env[name] ?? fallback
    if (!value) throw new Error(`${name} is required for R2 image publishing`)
    return value
  }
  const publicBaseUrl = get(
    'R2_ASSET_PUBLIC_BASE_URL',
    'https://assets.cadencetcg.dev',
  )
  return {
    originalsBucket: get(
      'R2_ASSET_ORIGINALS_BUCKET',
      'cadence-assets-originals',
    ),
    publicBucket: get('R2_ASSET_PUBLIC_BUCKET', 'cadence-assets-public'),
    publicBaseUrl,
    registryPath: resolve(workspace, 'config/admin/image-assets.json'),
    store: createR2AssetStore({
      accountId: get('R2_ASSET_ACCOUNT_ID'),
      accessKeyId: get('R2_ASSET_ACCESS_KEY_ID'),
      secretAccessKey: get('R2_ASSET_SECRET_ACCESS_KEY'),
      publicBaseUrl,
    }),
  }
}
