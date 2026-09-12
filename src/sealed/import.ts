import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { mkdir, rm } from 'node:fs/promises'
import { createIdentity } from '../identity/cadence-id.js'
import { stableJson, writeJson } from '../util/json.js'

interface CandidateInput {
  schemaVersion: 1
  provider: 'tcgcsv'
  game: string
  categoryId: number
  fetchedAt: string
  candidates: Array<{
    providerProductId: string
    name: string
    groupId: string
    groupName?: string
    productFamily: string
    externalIds: { 'tcgplayer.productId': string }
    imageUrl?: string
    sourceUrl?: string
    reasons: string[]
  }>
}

export interface SealedProduct {
  id: string
  identityKey: string
  game: string
  name: string
  productFamily: string
  groupId: string
  groupName?: string
  externalIds: { 'tcgplayer.productId': string }
  image: { sourceUrl?: string; status: 'reference-only' | 'unavailable' }
  provenance: { provider: 'tcgcsv'; release: string; sourceUrl?: string; importedAt: string }
}

function input(value: unknown): CandidateInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('sealed candidate input must be an object')
  const item = value as Partial<CandidateInput>
  if (
    item.schemaVersion !== 1 ||
    item.provider !== 'tcgcsv' ||
    typeof item.game !== 'string' ||
    !item.game.trim() ||
    !Array.isArray(item.candidates) ||
    typeof item.fetchedAt !== 'string' ||
    Number.isNaN(Date.parse(item.fetchedAt))
  )
    throw new Error('sealed candidate input is invalid')
  return item as CandidateInput
}

export function importSealedCandidates(value: unknown): {
  game: string
  fetchedAt: string
  products: SealedProduct[]
} {
  const source = input(value)
  const products = source.candidates.map((candidate) => {
    if (
      !candidate.providerProductId ||
      !candidate.name?.trim() ||
      !candidate.productFamily?.trim() ||
      candidate.externalIds?.['tcgplayer.productId'] !== candidate.providerProductId
    )
      throw new Error('sealed candidate is invalid')
    const identity = createIdentity(
      'sealed-product',
      source.game,
      candidate.productFamily,
      candidate.providerProductId,
    )
    return {
      ...identity,
      game: source.game,
      name: candidate.name.trim(),
      productFamily: candidate.productFamily.trim(),
      groupId: candidate.groupId,
      ...(candidate.groupName ? { groupName: candidate.groupName } : {}),
      externalIds: candidate.externalIds,
      image: candidate.imageUrl
        ? { sourceUrl: candidate.imageUrl, status: 'reference-only' as const }
        : { status: 'unavailable' as const },
      provenance: {
        provider: 'tcgcsv' as const,
        release: source.fetchedAt,
        ...(candidate.sourceUrl ? { sourceUrl: candidate.sourceUrl } : {}),
        importedAt: source.fetchedAt,
      },
    }
  })
  const ids = new Set(products.map((product) => product.id))
  if (ids.size !== products.length) throw new Error('sealed candidates are not unique')
  return {
    game: source.game,
    fetchedAt: source.fetchedAt,
    products: products.sort((a, b) => a.id.localeCompare(b.id)),
  }
}

export async function publishSealedCandidates(
  value: unknown,
  output: string,
): Promise<{ buildId: string; products: number }> {
  const catalog = importSealedCandidates(value)
  await rm(output, { recursive: true, force: true })
  await mkdir(output, { recursive: true })
  const path = `sealed/${catalog.game}/products.json`
  const artifact = await writeJson(join(output, path), catalog.products)
  const descriptor = {
    schemaVersion: 1,
    generatedAt: catalog.fetchedAt,
    game: catalog.game,
    artifacts: [{ path, ...artifact, records: catalog.products.length }],
  }
  const buildId = createHash('sha256')
    .update(stableJson(descriptor))
    .digest('hex')
    .slice(0, 16)
  await writeJson(join(output, 'sealed/manifest.json'), { ...descriptor, buildId })
  return { buildId, products: catalog.products.length }
}
