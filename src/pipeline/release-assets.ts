import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { SourceRelease } from '../domain/catalog.js'
import { sha256, stableJson } from '../util/json.js'

interface ReleaseManifest {
  schemaVersion: string
  buildId: string
  generatedAt: string
  provider: { release: string }
}

export async function createReleaseMetadata(
  manifestPath: string,
  releaseFile: string,
  archivePath: string,
  output: string,
  repository: string,
): Promise<void> {
  const manifest = JSON.parse(
    await readFile(manifestPath, 'utf8'),
  ) as ReleaseManifest
  const release = JSON.parse(
    await readFile(releaseFile, 'utf8'),
  ) as SourceRelease
  if (manifest.provider.release !== release.id)
    throw new Error('Manifest and source release identifiers differ')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
    throw new Error('Repository must use owner/name syntax')
  const archive = await readFile(archivePath)
  const archiveName = basename(archivePath)
  const tag = `catalog-v${manifest.schemaVersion}-${release.id}`
  const baseUrl = `https://github.com/${repository}/releases/download/${tag}`
  await mkdir(output, { recursive: true })
  const copiedManifest = join(output, 'manifest.json')
  const importReport = join(dirname(manifestPath), 'import-report.json')
  await copyFile(manifestPath, copiedManifest)
  await copyFile(importReport, join(output, 'import-report.json'))
  await copyFile(archivePath, join(output, archiveName))
  const files = [
    copiedManifest,
    join(output, 'import-report.json'),
    join(output, archiveName),
  ]
  const checksums: string[] = []
  for (const file of files) {
    const data = await readFile(file)
    checksums.push(`${sha256(data)}  ${basename(file)}`)
  }
  await writeFile(
    join(output, 'SHA256SUMS'),
    `${checksums.sort().join('\n')}\n`,
  )
  await writeFile(
    join(output, 'latest.json'),
    stableJson({
      schemaVersion: manifest.schemaVersion,
      buildId: manifest.buildId,
      generatedAt: manifest.generatedAt,
      providerRelease: release.id,
      tag,
      manifestUrl: `${baseUrl}/manifest.json`,
      archive: {
        url: `${baseUrl}/${archiveName}`,
        bytes: (await stat(archivePath)).size,
        sha256: sha256(archive),
      },
    }),
  )
}
