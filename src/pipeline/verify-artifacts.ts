import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { sha256 } from '../util/json.js'

interface ManifestArtifact {
  path: string
  bytes: number
  sha256: string
  records: number
}

interface PublishedManifest {
  schemaVersion: string
  buildId: string
  artifacts: ManifestArtifact[]
  validation: { valid: boolean; errors: number; warnings: number }
}

function parseManifest(input: unknown): PublishedManifest {
  if (!input || typeof input !== 'object')
    throw new Error('Manifest must be an object')
  const value = input as Partial<PublishedManifest>
  if (
    typeof value.schemaVersion !== 'string' ||
    typeof value.buildId !== 'string' ||
    !Array.isArray(value.artifacts) ||
    !value.validation?.valid ||
    value.validation.errors !== 0
  ) {
    throw new Error('Manifest is incomplete or records failed validation')
  }
  return value as PublishedManifest
}

function safeArtifactPath(root: string, path: string): string {
  if (isAbsolute(path))
    throw new Error(`Artifact path must be relative: ${path}`)
  const target = resolve(root, path)
  const fromRoot = relative(resolve(root), target)
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error(`Artifact escapes publication root: ${path}`)
  }
  return target
}

export async function verifyPublishedArtifacts(
  manifestPath: string,
  root: string,
): Promise<number> {
  const manifest = parseManifest(
    JSON.parse(await readFile(manifestPath, 'utf8')) as unknown,
  )
  const paths = new Set<string>()
  for (const artifact of manifest.artifacts) {
    if (
      !artifact ||
      typeof artifact.path !== 'string' ||
      !Number.isSafeInteger(artifact.bytes) ||
      !Number.isSafeInteger(artifact.records) ||
      !/^[a-f0-9]{64}$/.test(artifact.sha256)
    ) {
      throw new Error('Manifest contains an invalid artifact entry')
    }
    if (paths.has(artifact.path))
      throw new Error(`Manifest repeats artifact path: ${artifact.path}`)
    paths.add(artifact.path)
    const target = safeArtifactPath(root, artifact.path)
    const metadata = await stat(target)
    if (!metadata.isFile())
      throw new Error(`Artifact is not a file: ${artifact.path}`)
    const data = await readFile(target)
    if (data.length !== artifact.bytes) {
      throw new Error(
        `Artifact byte size mismatch for ${artifact.path}: expected ${artifact.bytes}, received ${data.length}`,
      )
    }
    const digest = sha256(data)
    if (digest !== artifact.sha256) {
      throw new Error(
        `Artifact checksum mismatch for ${artifact.path}: expected ${artifact.sha256}, received ${digest}`,
      )
    }
  }
  if (manifest.artifacts.length === 0)
    throw new Error('Manifest has no artifacts')
  return manifest.artifacts.length
}
