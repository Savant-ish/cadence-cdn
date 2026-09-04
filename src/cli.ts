#!/usr/bin/env node
import { resolve, join } from 'node:path'
import { TcgjsonProvider } from './providers/tcgjson/client.js'
import { buildCatalog } from './pipeline/ingest.js'
import { verifyPublishedArtifacts } from './pipeline/verify-artifacts.js'
import { createReleaseMetadata } from './pipeline/release-assets.js'

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
      'Usage: catalog <fetch|build|validate|verify-manifest|package-release> [options]',
    )
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
  const providerName = textFlag(parsed.flags, 'provider', 'tcgjson')
  const game = textFlag(parsed.flags, 'game', 'pokemon')
  if (providerName !== 'tcgjson' || game !== 'pokemon')
    throw new Error('MVP supports --provider tcgjson --game pokemon')
  if (parsed.command === 'fetch') {
    const provider = new TcgjsonProvider()
    const release = await provider.resolveRelease(
      textFlag(parsed.flags, 'release', 'latest'),
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
  if (parsed.command === 'build' || parsed.command === 'validate') {
    const snapshot = resolve(
      textFlag(
        parsed.flags,
        'snapshot',
        'fixtures/tcgjson/pokemon.sample.json',
      ),
    )
    const report = await buildCatalog({
      snapshot,
      output: resolve(textFlag(parsed.flags, 'output', 'dist')),
      ...(parsed.flags.has('release-file')
        ? { releaseFile: resolve(textFlag(parsed.flags, 'release-file')) }
        : {}),
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
      dryRun: parsed.command === 'validate' || parsed.flags.has('dry-run'),
    })
    console.log(
      `Valid: ${report.counts.sets} sets, ${report.counts.cards} cards, ${report.counts.printings} printings; ${report.issues.filter((item) => item.severity === 'warning').length} warnings`,
    )
    return
  }
  throw new Error(`Unknown command: ${parsed.command}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
