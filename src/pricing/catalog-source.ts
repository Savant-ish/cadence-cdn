import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { sha256, writeJson } from '../util/json.js'

interface CatalogPointer {
  schemaVersion: string
  buildId: string
  manifestUrl: string
  catalogBaseUrl: string
}

interface CatalogManifest {
  schemaVersion: string
  buildId: string
  artifacts: Array<{ path: string; bytes: number; sha256: string }>
}

async function response(url: string, request: typeof fetch): Promise<Response> {
  const result = await request(url, { signal: AbortSignal.timeout(120_000) })
  if (!result.ok)
    throw new Error(`Catalog request failed for ${url}: HTTP ${result.status}`)
  return result
}

export async function fetchPublishedPrintings(
  options: {
    latestUrl: string
    game: string
    output: string
    metadata: string
  },
  request: typeof fetch = fetch,
): Promise<{ buildId: string; printings: number }> {
  const latestUrl = new URL(options.latestUrl)
  if (latestUrl.protocol !== 'https:')
    throw new Error('Catalog pointer URL must use HTTPS')
  const pointer = (await (
    await response(latestUrl.toString(), request)
  ).json()) as CatalogPointer
  if (
    !/^[a-f0-9]{16}$/.test(pointer.buildId) ||
    typeof pointer.manifestUrl !== 'string'
  )
    throw new Error('Catalog pointer is invalid')
  const manifestUrl = new URL(pointer.manifestUrl)
  const baseUrl = new URL(pointer.catalogBaseUrl)
  if (
    manifestUrl.origin !== latestUrl.origin ||
    baseUrl.origin !== latestUrl.origin
  )
    throw new Error('Catalog pointer uses an unexpected artifact origin')
  const manifest = (await (
    await response(manifestUrl.toString(), request)
  ).json()) as CatalogManifest
  if (
    manifest.buildId !== pointer.buildId ||
    manifest.schemaVersion !== pointer.schemaVersion
  )
    throw new Error('Catalog manifest does not match its pointer')
  const path = `games/${options.game}/printings.json`
  const artifact = manifest.artifacts.find((item) => item.path === path)
  if (
    !artifact ||
    !Number.isSafeInteger(artifact.bytes) ||
    !/^[a-f0-9]{64}$/.test(artifact.sha256)
  )
    throw new Error(`Catalog manifest does not declare ${path}`)
  const artifactUrl = new URL(
    `${baseUrl.toString().replace(/\/$/, '')}/${path}`,
  )
  if (artifactUrl.origin !== latestUrl.origin)
    throw new Error('Catalog artifact uses an unexpected origin')
  const bytes = Buffer.from(
    await (await response(artifactUrl.toString(), request)).arrayBuffer(),
  )
  if (bytes.length !== artifact.bytes || sha256(bytes) !== artifact.sha256)
    throw new Error('Catalog printing artifact failed checksum verification')
  const printings = JSON.parse(bytes.toString('utf8')) as unknown[]
  if (!Array.isArray(printings))
    throw new Error('Catalog printing artifact is not an array')
  await mkdir(dirname(options.output), { recursive: true })
  await writeFile(options.output, bytes)
  await writeJson(options.metadata, {
    schemaVersion: pointer.schemaVersion,
    buildId: pointer.buildId,
    game: options.game,
    artifactUrl: artifactUrl.toString(),
    bytes: artifact.bytes,
    sha256: artifact.sha256,
    printings: printings.length,
  })
  return { buildId: pointer.buildId, printings: printings.length }
}
