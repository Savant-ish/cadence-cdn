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

export interface BuildOptions {
  snapshot: string
  releaseFile?: string
  output: string
  importedAt?: string
  previousManifest?: string
  allowCountDrop?: boolean
  dryRun?: boolean
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
  const report = validateCatalog(catalog)
  if (!options.allowCountDrop)
    await checkCountRegression(report, options.previousManifest)
  assertValid(report)
  if (!options.dryRun)
    await publishCatalog(catalog, report, release, options.output, importedAt)
  return report
}
