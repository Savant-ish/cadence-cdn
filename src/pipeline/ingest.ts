import { dirname, join } from 'node:path'
import { access, readFile } from 'node:fs/promises'
import { TcgjsonProvider, loadSnapshot } from '../providers/tcgjson/client.js'
import type {
  CatalogPrinting,
  SourceRelease,
  ValidationReport,
} from '../domain/catalog.js'
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
import { applyChangeSets, loadChangeSets } from '../admin/changesets.js'

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
  changesPath?: string
  includeDraftChanges?: boolean
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

interface ManifestArtifact {
  path: string
}

interface ManifestFile {
  buildId?: string
  artifacts?: ManifestArtifact[]
}

function canonicalIdentityKey(printing: CatalogPrinting): string {
  const normalize = (value: string | undefined): string =>
    value?.trim() ? value.trim() : '(unknown)'
  return [
    printing.cardId,
    printing.setId,
    printing.language,
    normalize(printing.edition),
    normalize(printing.finish),
  ].join('|')
}

async function compareStablePrintingIds(
  report: ValidationReport,
  currentPrintings: CatalogPrinting[],
  previousManifestPath: string | undefined,
): Promise<void> {
  if (!previousManifestPath) return
  let previous: ManifestFile
  try {
    previous = JSON.parse(
      await readFile(previousManifestPath, 'utf8'),
    ) as ManifestFile
  } catch (error) {
    report.issues.push({
      severity: 'warning',
      code: 'manifest-read-failure',
      message: `Could not read previous manifest: ${String(error)}`,
    })
    return
  }
  const artifactPaths = (previous.artifacts ?? []).filter((item) =>
    /^games\/[^/]+\/printings\.json$/i.test(item.path),
  )
  if (!artifactPaths.length) {
    report.issues.push({
      severity: 'warning',
      code: 'previous-printings-missing',
      message:
        'No previous per-game printings artifacts were found in prior manifest',
    })
    return
  }
  const previousRoot = dirname(previousManifestPath)
  const previousPrintings = [] as CatalogPrinting[]
  for (const artifact of artifactPaths) {
    try {
      const rows = JSON.parse(
        await readFile(join(previousRoot, artifact.path), 'utf8'),
      ) as unknown
      if (Array.isArray(rows))
        previousPrintings.push(...(rows as CatalogPrinting[]))
    } catch (error) {
      report.issues.push({
        severity: 'warning',
        code: 'previous-printings-read-failed',
        message: `${artifact.path} could not be loaded from previous manifest: ${String(error)}`,
      })
    }
  }
  if (!previousPrintings.length) return
  const previousBuildId = previous.buildId ?? 'unknown'
  const previousByIdentity = new Map<string, string>(
    previousPrintings.map((item) => [canonicalIdentityKey(item), item.id]),
  )
  const currentByIdentity = new Map<string, string>()
  let unstablePrintingIds = 0
  for (const printing of currentPrintings) {
    const identity = canonicalIdentityKey(printing)
    currentByIdentity.set(identity, printing.id)
    const priorId = previousByIdentity.get(identity)
    if (priorId && priorId !== printing.id) unstablePrintingIds += 1
  }
  const previousIdentities = [...previousByIdentity.keys()]
  const currentIdentities = [...currentByIdentity.keys()]
  const stableMatches = currentIdentities.filter((identity) =>
    previousByIdentity.has(identity),
  ).length
  const stableSummary = {
    previousBuildId,
    stableMatches,
    addedIdentities: currentIdentities.length - stableMatches,
    missingIdentities: previousIdentities.length - stableMatches,
    unstablePrintingIds,
  }
  if (!report.identityAudit)
    report.identityAudit = {
      printingsByLanguage: {},
      printingsByEdition: {},
      printingsByFinish: {},
      compoundFinishCount: 0,
      editionEmbeddedInFinishCount: 0,
      duplicatePhysicalIdentityCount: 0,
    }
  report.identityAudit.stableIdComparison = stableSummary
  if (unstablePrintingIds)
    report.issues.push({
      severity: 'warning',
      code: 'unstable-printing-id',
      message: `${unstablePrintingIds} unchanged catalog printing identities resolved to new printing IDs versus ${previousBuildId}`,
    })
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
  const overrideReport = applyChangeSets(
    catalog,
    await loadChangeSets(
      options.changesPath ?? 'config/admin/change-sets.json',
    ),
    options.includeDraftChanges,
  )
  const report = validateCatalog(catalog)
  report.overrides = {
    changeSets: overrideReport.changeSets,
    operations: overrideReport.operations,
    matches: overrideReport.matches,
    skippedDrafts: overrideReport.skippedDrafts,
    details: overrideReport.details,
  }
  if (!options.includeDraftChanges)
    for (const detail of overrideReport.details)
      if (detail.matches === 0)
        report.issues.push({
          severity: 'error',
          code: 'override-no-match',
          message: `${detail.changeSetId} operation ${detail.operation} matched no ${detail.entity} records`,
        })
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
  await compareStablePrintingIds(
    report,
    catalog.printings,
    options.previousManifest,
  )
  if (!options.allowCountDrop)
    await checkCountRegression(report, options.previousManifest)
  assertValid(report)
  if (!options.dryRun)
    await publishCatalog(catalog, report, release, options.output, importedAt)
  return report
}
