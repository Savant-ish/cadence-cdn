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
  releaseFile?: string
  output: string
  importedAt?: string
  previousManifest?: string
  allowCountDrop?: boolean
  dryRun?: boolean
  taxonomyPath?: string
  requireApprovedTaxonomy?: boolean
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
  const provider = new TcgjsonProvider()
  let release: SourceRelease = {
    provider: 'tcgjson',
    id: 'fixture',
    manifestUrl: 'fixture://bulk-data.json',
    artifactUrl: options.snapshot,
    artifactName: 'catalog.json',
  }
  const releaseFile =
    options.releaseFile ?? join(options.snapshot, '..', 'release.json')
  try {
    await access(releaseFile)
    release = JSON.parse(await readFile(releaseFile, 'utf8')) as SourceRelease
  } catch {
    /* fixture or explicitly supplied standalone snapshot */
  }
  const importedAt = options.importedAt ?? deterministicTimestamp(release.id)
  const input = await loadSnapshot(options.snapshot)
  const catalog = await provider.normalize(input, { release, importedAt })
  const taxonomy = await loadTaxonomy(
    options.taxonomyPath ?? 'config/taxonomy/pokemon-sets.json',
  )
  applyApprovedTaxonomy(catalog.sets, taxonomy)
  const report = validateCatalog(catalog)
  const coverage = taxonomyReport(catalog.sets, taxonomy)
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
