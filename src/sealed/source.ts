import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { sha256 } from '../util/json.js'

interface PricingLatest {
  manifestUrl: string
  pricingBaseUrl: string
}

interface PricingManifest {
  artifacts: Array<{ path: string; sha256: string }>
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

export async function fetchSealedCandidates(options: {
  latestUrl: string
  output: string
  request?: typeof fetch
}): Promise<{ bytes: number; sha256: string; sourceUrl: string }> {
  const request = options.request ?? fetch
  const getJson = async (url: string): Promise<unknown> => {
    const response = await request(url, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok) throw new Error(`Fetch failed: ${response.status} ${url}`)
    return response.json()
  }
  const latest = object(await getJson(options.latestUrl), 'Pricing latest') as PricingLatest
  if (!latest.manifestUrl || !latest.pricingBaseUrl)
    throw new Error('Pricing latest is missing manifestUrl or pricingBaseUrl')
  const manifest = object(await getJson(latest.manifestUrl), 'Pricing manifest') as PricingManifest
  const artifact = manifest.artifacts?.find(
    (item) => item.path === 'sealed-candidates.json',
  )
  if (!artifact || !/^[a-f0-9]{64}$/.test(artifact.sha256))
    throw new Error('Pricing manifest has no sealed-candidates artifact')
  const sourceUrl = `${latest.pricingBaseUrl.replace(/\/$/, '')}/${artifact.path}`
  const response = await request(sourceUrl, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`Fetch failed: ${response.status} ${sourceUrl}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const digest = sha256(bytes)
  if (digest !== artifact.sha256)
    throw new Error('Sealed candidate checksum does not match pricing manifest')
  await mkdir(dirname(options.output), { recursive: true })
  await writeFile(options.output, bytes)
  return { bytes: bytes.length, sha256: digest, sourceUrl }
}
