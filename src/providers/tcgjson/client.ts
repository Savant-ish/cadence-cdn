import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { CatalogProvider } from '../provider.js'
import type {
  ImportContext,
  NormalizedCatalog,
  SourceRelease,
} from '../../domain/catalog.js'
import { mapLorcana, mapPokemon } from './mapper.js'
import { GAME_REGISTRY, isGameSlug, type GameSlug } from '../../config/games.js'

export const TCGJSON_GAMES = Object.keys(GAME_REGISTRY) as GameSlug[]

const MANIFEST_URL =
  'https://github.com/HanClinto/tcgjson/releases/latest/download/bulk-data.json'

async function download(url: string, attempts = 3): Promise<Buffer> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(60_000),
      })
      if (!response.ok)
        throw new Error(`${response.status} ${response.statusText}`)
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      lastError = error
      if (attempt < attempts)
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt))
    }
  }
  throw new Error(`Failed to download ${url}: ${String(lastError)}`)
}

function records(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value))
    return value.filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === 'object',
    )
  if (!value || typeof value !== 'object') return []
  for (const key of ['data', 'files', 'artifacts']) {
    const nested = (value as Record<string, unknown>)[key]
    if (Array.isArray(nested)) return records(nested)
  }
  return []
}

function textField(
  value: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys)
    if (typeof value[key] === 'string' && value[key])
      return value[key] as string
  return undefined
}

function numberField(
  value: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) if (typeof value[key] === 'number') return value[key]
  return undefined
}

export class TcgjsonProvider implements CatalogProvider {
  readonly name = 'tcgjson'

  async resolveRelease(
    requested = 'latest',
    game = 'pokemon',
  ): Promise<SourceRelease> {
    if (!isGameSlug(game)) throw new Error(`Unsupported tcgjson game: ${game}`)
    const manifestUrl =
      requested === 'latest'
        ? MANIFEST_URL
        : `https://github.com/HanClinto/tcgjson/releases/download/${encodeURIComponent(requested)}/bulk-data.json`
    const raw = await download(manifestUrl)
    const manifest = JSON.parse(raw.toString('utf8')) as Record<string, unknown>
    const entry = records(manifest).find((item) => {
      const name =
        textField(
          item,
          'download_uri',
          'name',
          'fileName',
          'filename',
          'path',
        ) ?? ''
      return new RegExp(`(^|/)${game}\\.full\\.json(\\.gz)?$`, 'i').test(name)
    })
    if (!entry)
      throw new Error(
        `The tcgjson manifest does not contain ${game}.full.json or ${game}.full.json.gz`,
      )
    const artifactName = textField(
      entry,
      'download_uri',
      'name',
      'fileName',
      'filename',
      'path',
    )!
    const rawUrl = textField(
      entry,
      'download_uri',
      'downloadUri',
      'downloadUrl',
      'url',
      'uri',
    )
    const base = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1)
    const artifactUrl = rawUrl
      ? new URL(rawUrl, base).toString()
      : new URL(artifactName, base).toString()
    const generatedAt = textField(manifest, 'generated_at', 'generatedAt')
    const release =
      textField(manifest, 'release', 'version', 'id') ??
      textField(entry, 'release', 'version') ??
      (generatedAt
        ? `weekly-${generatedAt.slice(0, 10).replaceAll('-', '')}`
        : undefined) ??
      requested
    const hash = textField(entry, 'sha256', 'sha256Hash', 'hash')?.replace(
      /^sha256:/,
      '',
    )
    const size = numberField(entry, 'size', 'bytes', 'fileSize')
    return {
      provider: this.name,
      id: release,
      manifestUrl,
      artifactUrl,
      artifactName,
      ...(hash
        ? {
            checksum: {
              algorithm: 'sha256' as const,
              value: hash.toLowerCase(),
            },
          }
        : {}),
      ...(size !== undefined ? { size } : {}),
    }
  }

  async fetchGame(
    release: SourceRelease,
    game: string,
    destination: string,
  ): Promise<string> {
    if (!isGameSlug(game)) throw new Error(`Unsupported tcgjson game: ${game}`)
    const compressed = await download(release.artifactUrl)
    if (release.size !== undefined && compressed.length !== release.size) {
      throw new Error(
        `Artifact size mismatch: expected ${release.size}, received ${compressed.length}`,
      )
    }
    if (release.checksum) {
      const actual = createHash('sha256').update(compressed).digest('hex')
      if (actual !== release.checksum.value)
        throw new Error(
          `Artifact checksum mismatch: expected ${release.checksum.value}, received ${actual}`,
        )
    }
    const body = release.artifactName.endsWith('.gz')
      ? gunzipSync(compressed)
      : compressed
    const path = join(destination, 'catalog.json')
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, body)
    await writeFile(
      join(destination, 'release.json'),
      `${JSON.stringify(release, null, 2)}\n`,
    )
    return path
  }

  async normalize(
    input: unknown,
    context: ImportContext,
    game = 'pokemon',
  ): Promise<NormalizedCatalog> {
    if (game === 'pokemon') return mapPokemon(input, context)
    if (game === 'lorcana') return mapLorcana(input, context)
    throw new Error(`Unsupported tcgjson game: ${game}`)
  }
}

export async function loadSnapshot(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}
