import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  IDENTITY_VERSION,
  SCHEMA_VERSION,
  type NormalizedCatalog,
  type SourceRelease,
  type ValidationReport,
} from '../domain/catalog.js'
import { stableJson, writeJson } from '../util/json.js'

interface Artifact {
  path: string
  bytes: number
  sha256: string
  records: number
}

interface BuildDescriptor {
  schemaVersion: string
  identityVersion: string
  generatedAt: string
  provider: { name: string; release: string; manifestUrl: string }
  supportedGames: string[]
  counts: ValidationReport['counts']
  artifacts: Artifact[]
  operationalArtifacts: Array<{
    path: string
    bytes: number
    sha256: string
  }>
  validation: { valid: boolean; errors: number; warnings: number }
  imagePolicy: 'reference-only'
}

export function publicationBuildId(descriptor: BuildDescriptor): string {
  return createHash('sha256')
    .update(stableJson(descriptor))
    .digest('hex')
    .slice(0, 16)
}

export async function publishCatalog(
  catalog: NormalizedCatalog,
  report: ValidationReport,
  release: SourceRelease,
  output: string,
  generatedAt: string,
): Promise<void> {
  await rm(output, { recursive: true, force: true })
  await mkdir(output, { recursive: true })
  const artifacts: Artifact[] = []
  const emit = async (relative: string, value: unknown, records: number) => {
    const result = await writeJson(join(output, relative), value)
    artifacts.push({ path: relative.replaceAll('\\', '/'), ...result, records })
  }
  await emit('games.json', catalog.games, catalog.games.length)
  const gameRoot = 'games/pokemon'
  await emit(`${gameRoot}/sets.json`, catalog.sets, catalog.sets.length)
  await emit(`${gameRoot}/cards.json`, catalog.cards, catalog.cards.length)
  await emit(
    `${gameRoot}/printings.json`,
    catalog.printings,
    catalog.printings.length,
  )
  for (const set of catalog.sets) {
    const printings = catalog.printings.filter((item) => item.setId === set.id)
    const cardIds = new Set(printings.map((item) => item.cardId))
    const fileId = set.id.replaceAll(':', '_')
    await emit(
      `${gameRoot}/sets/${fileId}.json`,
      {
        set,
        cards: catalog.cards.filter((item) => cardIds.has(item.id)),
        printings,
      },
      printings.length,
    )
  }
  await emit(
    `${gameRoot}/index.json`,
    {
      game: catalog.games[0],
      artifacts: {
        sets: 'sets.json',
        cards: 'cards.json',
        printings: 'printings.json',
      },
      counts: report.counts,
    },
    1,
  )
  artifacts.sort((a, b) => a.path.localeCompare(b.path))
  const importReport = await writeJson(
    join(output, 'import-report.json'),
    report,
  )
  const descriptor: BuildDescriptor = {
    schemaVersion: SCHEMA_VERSION,
    identityVersion: IDENTITY_VERSION,
    generatedAt,
    provider: {
      name: release.provider,
      release: release.id,
      manifestUrl: release.manifestUrl,
    },
    supportedGames: ['pokemon'],
    counts: report.counts,
    artifacts,
    operationalArtifacts: [{ path: 'import-report.json', ...importReport }],
    validation: {
      valid: report.valid,
      errors: report.issues.filter((item) => item.severity === 'error').length,
      warnings: report.issues.filter((item) => item.severity === 'warning')
        .length,
    },
    imagePolicy: 'reference-only',
  }
  await writeJson(join(output, 'manifest.json'), {
    ...descriptor,
    buildId: publicationBuildId(descriptor),
  })
}
