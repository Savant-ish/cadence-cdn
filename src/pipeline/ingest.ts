import { join } from 'node:path'
import { access, readFile } from 'node:fs/promises'
import { TcgjsonProvider, loadSnapshot } from '../providers/tcgjson/client.js'
import type { SourceRelease } from '../domain/catalog.js'
import {
  assertValid,
  checkCountRegression,
  validateCatalog,
} from './validate.js'
import { publishCatalog } from './publish.js'
import {
  applyApprovedTaxonomy,
  loadTaxonomy,
  taxonomyReport,
} from '../taxonomy/pokemon.js'

export interface BuildOptions {
  snapshot: string
  game?: string
  releaseFile?: string
  output: string
  importedAt?: string
  previousManifest?: string
  allowCountDrop?: boolean
  dryRun?: boolean
  taxonomyPath?: string
  requireApprovedTaxonomy?: boolean
}

export interface BuildSource {
  game: string
  snapshot: string
  releaseFile?: string
}

export interface BundleBuildOptions extends Omit<
  BuildOptions,
  'snapshot' | 'releaseFile' | 'game'
> {
  sources: BuildSource[]
}

export function deterministicTimestamp(release: string): string {
  const match = release.match(/(20\d{2})(\d{2})(\d{2})/)
  return match
    ? `${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`
    : '1970-01-01T00:00:00.000Z'
}

export async function buildCatalog(
  options: BuildOptions,
): Promise<ReturnType<typeof validateCatalog>> {
  return buildCatalogBundle({
    ...options,
    sources: [
      {
        game: options.game ?? 'pokemon',
        snapshot: options.snapshot,
        ...(options.releaseFile ? { releaseFile: options.releaseFile } : {}),
      },
    ],
  })
}

export async function buildCatalogBundle(
  options: BundleBuildOptions,
): Promise<ReturnType<typeof validateCatalog>> {
  const provider = new TcgjsonProvider()
  if (!options.sources.length)
    throw new Error('At least one catalog source is required')
  const catalogs = []
  const releases: SourceRelease[] = []
  for (const source of options.sources) {
    let release: SourceRelease = {
      provider: 'tcgjson',
      id: 'fixture',
      manifestUrl: 'fixture://bulk-data.json',
      artifactUrl: source.snapshot,
      artifactName: 'catalog.json',
    }
    const releaseFile =
      source.releaseFile ?? join(source.snapshot, '..', 'release.json')
    try {
      await access(releaseFile)
      release = JSON.parse(await readFile(releaseFile, 'utf8')) as SourceRelease
    } catch {
      /* fixture or explicitly supplied standalone snapshot */
    }
    releases.push(release)
    const importedAt = options.importedAt ?? deterministicTimestamp(release.id)
    const input = await loadSnapshot(source.snapshot)
    catalogs.push(
      await provider.normalize(input, { release, importedAt }, source.game),
    )
  }
  const release = releases[0]!
  for (const candidate of releases.slice(1)) {
    if (
      candidate.id !== release.id ||
      candidate.manifestUrl !== release.manifestUrl
    )
      throw new Error(
        'All game snapshots must come from the same provider release',
      )
  }
  const importedAt = options.importedAt ?? deterministicTimestamp(release.id)
  const catalog = {
    games: catalogs.flatMap((item) => item.games),
    sets: catalogs.flatMap((item) => item.sets),
    cards: catalogs.flatMap((item) => item.cards),
    printings: catalogs.flatMap((item) => item.printings),
  }
  const taxonomy = await loadTaxonomy(
    options.taxonomyPath ?? 'config/taxonomy/pokemon-sets.json',
  )
  const pokemonGameIds = new Set(
    catalog.games
      .filter((item) => item.slug === 'pokemon')
      .map((item) => item.id),
  )
  const pokemonSets = catalog.sets.filter((item) =>
    pokemonGameIds.has(item.gameId),
  )
  applyApprovedTaxonomy(pokemonSets, taxonomy)
  const report = validateCatalog(catalog)
  const coverage = taxonomyReport(pokemonSets, taxonomy)
  for (const message of coverage.invalid)
    report.issues.push({ severity: 'error', code: 'invalid-taxonomy', message })
  if (
    options.requireApprovedTaxonomy &&
    coverage.approved !== coverage.totalSets
  )
    report.issues.push({
      severity: 'error',
      code: 'taxonomy-approval-required',
      message: `${coverage.totalSets - coverage.approved} sets lack approved taxonomy`,
    })
  report.valid = !report.issues.some((issue) => issue.severity === 'error')
  if (!options.allowCountDrop)
    await checkCountRegression(report, options.previousManifest)
  assertValid(report)
  if (!options.dryRun)
    await publishCatalog(catalog, report, release, options.output, importedAt)
  return report
}
