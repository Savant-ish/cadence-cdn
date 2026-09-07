#!/usr/bin/env node
import { resolve, join } from 'node:path'
import { TcgjsonProvider } from './providers/tcgjson/client.js'
import { buildCatalog, buildCatalogBundle } from './pipeline/ingest.js'
import { verifyPublishedArtifacts } from './pipeline/verify-artifacts.js'
import { createReleaseMetadata } from './pipeline/release-assets.js'
import { publishCatalogToR2 } from './pipeline/r2-publish.js'
import { loadSnapshot } from './providers/tcgjson/client.js'
import {
  loadTaxonomy,
  taxonomyReport,
  updateSuggestions,
} from './taxonomy/pokemon.js'
import { isGameSlug } from './config/games.js'
import { loadChangeSets } from './admin/changesets.js'
import { ingestPricingFile } from './pricing/ingest.js'
import { fetchTcgcsvPricing } from './pricing/tcgcsv.js'

function args(tokens: string[]): {
  command?: string
  flags: Map<string, string | true>
} {
  const [command, ...rest] = tokens
  const flags = new Map<string, string | true>()
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]!
    if (!token.startsWith('--'))
      throw new Error(`Unexpected argument: ${token}`)
    const next = rest[index + 1]
    if (next && !next.startsWith('--')) {
      flags.set(token.slice(2), next)
      index += 1
    } else flags.set(token.slice(2), true)
  }
  return { ...(command ? { command } : {}), flags }
}

function textFlag(
  flags: Map<string, string | true>,
  name: string,
  fallback?: string,
): string {
  const value = flags.get(name) ?? fallback
  if (typeof value !== 'string') throw new Error(`--${name} requires a value`)
  return value
}

async function main(): Promise<void> {
  const parsed = args(process.argv.slice(2))
  if (parsed.flags.has('help') || !parsed.command) {
    console.log(
      'Usage: catalog <fetch|build|validate|admin-preview|verify-manifest|package-release|publish-r2|taxonomy-suggest|taxonomy-report|admin-validate|pricing-ingest|pricing-fetch-tcgcsv> [options]',
    )
    return
  }
  if (parsed.command === 'pricing-fetch-tcgcsv') {
    const categoryId = Number(textFlag(parsed.flags, 'category-id'))
    const result = await fetchTcgcsvPricing({
      categoryId,
      output: resolve(
        textFlag(parsed.flags, 'output', 'snapshots/pricing/tcgcsv'),
      ),
      ...(parsed.flags.has('user-agent')
        ? { userAgent: textFlag(parsed.flags, 'user-agent') }
        : process.env.TCGCSV_USER_AGENT
          ? { userAgent: process.env.TCGCSV_USER_AGENT }
          : {}),
    })
    console.log(
      `Fetched TCGCSV ${result.release}: ${result.groups} groups, ${result.feed.observations.length} price observations`,
    )
    return
  }
  if (parsed.command === 'pricing-ingest') {
    const batch = await ingestPricingFile({
      input: resolve(textFlag(parsed.flags, 'input')),
      printings: resolve(textFlag(parsed.flags, 'printings')),
      catalogBuildId: textFlag(parsed.flags, 'catalog-build-id'),
      output: resolve(textFlag(parsed.flags, 'output', 'pricing-batch.json')),
    })
    console.log(
      `Pricing batch: ${batch.observations.length} accepted, ${batch.rejected.length} rejected`,
    )
    return
  }
  if (parsed.command === 'admin-validate') {
    const path = resolve(
      textFlag(parsed.flags, 'changes', 'config/admin/change-sets.json'),
    )
    const file = await loadChangeSets(path)
    if (!file) throw new Error(`Change-set file not found: ${path}`)
    console.log(`Valid: ${file.changeSets.length} catalog change sets`)
    return
  }
  if (parsed.command === 'verify-manifest') {
    const manifest = resolve(
      textFlag(parsed.flags, 'manifest', 'dist/manifest.json'),
    )
    const count = await verifyPublishedArtifacts(
      manifest,
      resolve(textFlag(parsed.flags, 'root', join(manifest, '..'))),
    )
    console.log(`Verified ${count} published artifacts`)
    return
  }
  if (parsed.command === 'package-release') {
    await createReleaseMetadata(
      resolve(textFlag(parsed.flags, 'manifest', 'dist/manifest.json')),
      resolve(textFlag(parsed.flags, 'release-file')),
      resolve(textFlag(parsed.flags, 'archive')),
      resolve(textFlag(parsed.flags, 'output', 'release-assets')),
      textFlag(parsed.flags, 'repository'),
    )
    console.log('Prepared release metadata and checksums')
    return
  }
  if (parsed.command === 'publish-r2') {
    const result = await publishCatalogToR2({
      root: resolve(textFlag(parsed.flags, 'root', 'dist')),
      bucket: textFlag(parsed.flags, 'bucket'),
      accountId: textFlag(
        parsed.flags,
        'account-id',
        process.env.R2_ACCOUNT_ID,
      ),
      publicBaseUrl: textFlag(parsed.flags, 'public-base-url'),
      accessKeyId: textFlag(
        parsed.flags,
        'access-key-id',
        process.env.R2_ACCESS_KEY_ID,
      ),
      secretAccessKey: textFlag(
        parsed.flags,
        'secret-access-key',
        process.env.R2_SECRET_ACCESS_KEY,
      ),
    })
    console.log(
      `Published build ${result.buildId}: ${result.uploaded} uploaded, ${result.skipped} unchanged`,
    )
    return
  }
  const providerName = textFlag(parsed.flags, 'provider', 'tcgjson')
  const game = textFlag(parsed.flags, 'game', 'pokemon')
  if (providerName !== 'tcgjson' || !isGameSlug(game))
    throw new Error(`Unsupported provider/game: ${providerName}/${game}`)
  if (
    parsed.command === 'taxonomy-suggest' ||
    parsed.command === 'taxonomy-report'
  ) {
    if (game !== 'pokemon')
      throw new Error('Set taxonomy tooling currently supports Pokémon only')
    const snapshot = resolve(
      textFlag(
        parsed.flags,
        'snapshot',
        'fixtures/tcgjson/pokemon.sample.json',
      ),
    )
    const taxonomyPath = resolve(
      textFlag(parsed.flags, 'taxonomy', 'config/taxonomy/pokemon-sets.json'),
    )
    const provider = new TcgjsonProvider()
    const catalog = await provider.normalize(await loadSnapshot(snapshot), {
      release: {
        provider: 'tcgjson',
        id: 'taxonomy-review',
        manifestUrl: 'taxonomy://review',
        artifactUrl: snapshot,
        artifactName: 'catalog.json',
      },
      importedAt: '1970-01-01T00:00:00.000Z',
    })
    const taxonomy =
      parsed.command === 'taxonomy-suggest'
        ? await updateSuggestions(catalog.sets, taxonomyPath)
        : await loadTaxonomy(taxonomyPath)
    const report = taxonomyReport(catalog.sets, taxonomy)
    console.log(JSON.stringify(report, null, 2))
    if (report.invalid.length) process.exitCode = 1
    return
  }
  if (parsed.command === 'fetch') {
    const provider = new TcgjsonProvider()
    const release = await provider.resolveRelease(
      textFlag(parsed.flags, 'release', 'latest'),
      game,
    )
    const destination = resolve(
      textFlag(
        parsed.flags,
        'output',
        join('snapshots', 'tcgjson', release.id, game),
      ),
    )
    const path = await provider.fetchGame(release, game, destination)
    console.log(`Fetched ${release.id} to ${path}`)
    return
  }
  if (
    parsed.command === 'build' ||
    parsed.command === 'validate' ||
    parsed.command === 'admin-preview'
  ) {
    const games = parsed.flags.has('games')
      ? textFlag(parsed.flags, 'games')
          .split(',')
          .map((item) => item.trim())
      : []
    for (const slug of games)
      if (!isGameSlug(slug)) throw new Error(`Unsupported game: ${slug}`)
    const shared = {
      output: resolve(textFlag(parsed.flags, 'output', 'dist')),
      ...(parsed.flags.has('imported-at')
        ? { importedAt: textFlag(parsed.flags, 'imported-at') }
        : {}),
      ...(parsed.flags.has('previous-manifest')
        ? {
            previousManifest: resolve(
              textFlag(parsed.flags, 'previous-manifest'),
            ),
          }
        : {}),
      allowCountDrop: parsed.flags.has('allow-count-drop'),
      dryRun:
        parsed.command === 'validate' ||
        parsed.command === 'admin-preview' ||
        parsed.flags.has('dry-run'),
      taxonomyPath: resolve(
        textFlag(parsed.flags, 'taxonomy', 'config/taxonomy/pokemon-sets.json'),
      ),
      requireApprovedTaxonomy: parsed.flags.has('require-approved-taxonomy'),
      changesPath: resolve(
        textFlag(parsed.flags, 'changes', 'config/admin/change-sets.json'),
      ),
      includeDraftChanges: parsed.command === 'admin-preview',
    }
    if (games.length) {
      const snapshotRoot = resolve(
        textFlag(parsed.flags, 'snapshot-root', 'snapshots/tcgjson/current'),
      )
      const report = await buildCatalogBundle({
        ...shared,
        sources: games.map((slug) => ({
          game: slug,
          snapshot: join(snapshotRoot, slug, 'catalog.json'),
          releaseFile: join(snapshotRoot, slug, 'release.json'),
        })),
      })
      console.log(
        `Valid: ${report.counts.games} games, ${report.counts.sets} sets, ${report.counts.cards} cards, ${report.counts.printings} printings; ${report.issues.filter((item) => item.severity === 'warning').length} warnings`,
      )
      if (parsed.command === 'admin-preview')
        console.log(JSON.stringify(report.overrides, null, 2))
      return
    }
    const snapshot = resolve(
      textFlag(
        parsed.flags,
        'snapshot',
        'fixtures/tcgjson/pokemon.sample.json',
      ),
    )
    const report = await buildCatalog({
      snapshot,
      game,
      ...shared,
      ...(parsed.flags.has('release-file')
        ? { releaseFile: resolve(textFlag(parsed.flags, 'release-file')) }
        : {}),
    })
    console.log(
      `Valid: ${report.counts.sets} sets, ${report.counts.cards} cards, ${report.counts.printings} printings; ${report.issues.filter((item) => item.severity === 'warning').length} warnings`,
    )
    if (parsed.command === 'admin-preview')
      console.log(JSON.stringify(report.overrides, null, 2))
    return
  }
  throw new Error(`Unknown command: ${parsed.command}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
