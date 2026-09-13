import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { CatalogPrinting } from '../domain/catalog.js'
import { stableJson, writeJson } from '../util/json.js'
import {
  PRICING_SCHEMA_VERSION,
  type NormalizedPriceObservation,
  type PricingBatch,
  type ProviderPriceFeed,
  type ProviderPriceObservation,
} from './domain.js'

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

const EDITION_PATTERN =
  /\b(?:\d+(?:st|nd|rd|th)?\s+edition|first\s+edition|unlimited)\b/i

function normalizeValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeEdition(value: string): string {
  const normalized = normalizeValue(value).toLowerCase()
  if (normalized === '1st edition' || normalized === 'first edition')
    return '1st edition'
  if (normalized === 'unlimited') return 'unlimited'
  if (normalized === '1st') return '1st edition'
  return normalizeValue(value)
}

function normalizeVariantField(value: string | undefined): string | undefined {
  const normalized = normalizeValue(value ?? '')
  return normalized ? normalized.toLowerCase() : undefined
}

interface CatalogVariant {
  language?: string
  edition?: string
  finish?: string
}

function extractObservationVariant(
  observation: ProviderPriceObservation,
): CatalogVariant {
  const language = normalizeVariantField(
    (observation as { language?: string }).language,
  )
  const explicitEdition = normalizeVariantField(
    (observation as { edition?: string }).edition,
  )
  const rawFinish = normalizeValue(
    (observation as { finish?: string }).finish ?? '',
  )
  if (!rawFinish) {
    return {
      ...(language ? { language } : {}),
      ...(explicitEdition ? { edition: explicitEdition } : {}),
    }
  }
  const match = rawFinish.match(EDITION_PATTERN)
  if (!match) {
    return {
      ...(language ? { language } : {}),
      finish: normalizeValue(rawFinish).toLowerCase(),
    }
  }
  const finish = normalizeVariantField(rawFinish.replace(match[0], ''))
  const edition = explicitEdition
    ? explicitEdition
    : normalizeEdition(match[0]).toLowerCase()
  return {
    ...(language ? { language } : {}),
    ...(edition ? { edition } : {}),
    ...(finish ? { finish } : {}),
  }
}

function isCandidateMatch(
  observation: ProviderPriceObservation,
  printing: CatalogPrinting,
): boolean {
  const requested = extractObservationVariant(observation)
  const observedLanguage = requested.language
  const observedEdition = requested.edition
  const observedFinish = requested.finish
  if (
    observedLanguage &&
    normalizeVariantField(printing.language) !== observedLanguage
  )
    return false
  if (observedEdition) {
    if (!printing.edition) return false
    if (normalizeEdition(printing.edition).toLowerCase() !== observedEdition)
      return false
  }
  if (observedFinish && !printing.finish) return false
  if (
    observedFinish &&
    normalizeVariantField(printing.finish) !== observedFinish
  ) {
    return false
  }
  return true
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}

function instant(value: unknown, label: string): string {
  const text = requiredString(value, label)
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text) || Number.isNaN(Date.parse(text)))
    throw new Error(`${label} must be an ISO 8601 timestamp`)
  return text
}

function validateObservation(
  value: unknown,
  index: number,
): ProviderPriceObservation {
  const item = object(value, `observations[${index}]`)
  requiredString(
    item.providerProductId,
    `observations[${index}].providerProductId`,
  )
  instant(item.observedAt, `observations[${index}].observedAt`)
  const currency = requiredString(
    item.currency,
    `observations[${index}].currency`,
  )
  if (!/^[A-Z]{3}$/.test(currency))
    throw new Error(
      `observations[${index}].currency must be an uppercase ISO currency code`,
    )
  if (!['retail', 'buylist'].includes(String(item.channel)))
    throw new Error(`observations[${index}].channel must be retail or buylist`)
  const prices = object(item.prices, `observations[${index}].prices`)
  const entries = Object.entries(prices)
  if (!entries.length)
    throw new Error(`observations[${index}].prices cannot be empty`)
  for (const [kind, amount] of entries) {
    if (!['market', 'low', 'mid', 'high'].includes(kind))
      throw new Error(`observations[${index}].prices.${kind} is unsupported`)
    if (!Number.isSafeInteger(amount) || Number(amount) < 0)
      throw new Error(
        `observations[${index}].prices.${kind} must be a non-negative integer in minor currency units`,
      )
  }
  if (item.sourceUrl !== undefined) {
    const sourceUrl = new URL(
      requiredString(item.sourceUrl, `observations[${index}].sourceUrl`),
    )
    if (!['http:', 'https:'].includes(sourceUrl.protocol))
      throw new Error(`observations[${index}].sourceUrl must use HTTP or HTTPS`)
  }
  return value as ProviderPriceObservation
}

export function validateProviderPriceFeed(value: unknown): ProviderPriceFeed {
  const feed = object(value, 'Pricing feed')
  if (feed.schemaVersion !== PRICING_SCHEMA_VERSION)
    throw new Error(
      `Pricing feed schemaVersion must be ${PRICING_SCHEMA_VERSION}`,
    )
  requiredString(feed.provider, 'provider')
  requiredString(feed.externalIdKey, 'externalIdKey')
  instant(feed.fetchedAt, 'fetchedAt')
  if (!Array.isArray(feed.observations))
    throw new Error('observations must be an array')
  feed.observations.forEach(validateObservation)
  return value as ProviderPriceFeed
}

function observationId(
  provider: string,
  observation: ProviderPriceObservation,
): string {
  return `price:${createHash('sha256')
    .update(stableJson({ provider, ...observation }))
    .digest('hex')
    .slice(0, 24)}`
}

export function normalizePricingFeed(
  rawFeed: unknown,
  printings: CatalogPrinting[],
  catalogBuildId: string,
): PricingBatch {
  const feed = validateProviderPriceFeed(rawFeed)
  const printingIds = new Set(printings.map((item) => item.id))
  const externalIdKey = feed.externalIdKey
  if (!catalogBuildId.trim()) throw new Error('catalogBuildId is required')
  const byExternalId = new Map<string, CatalogPrinting[]>()
  for (const printing of printings) {
    if (!printingIds.has(printing.id)) continue
    const printedIds = new Set<string>()
    for (const [provider, externalId] of Object.entries(printing.externalIds)) {
      if (
        provider !== externalIdKey &&
        !provider.startsWith(`${externalIdKey}:`)
      )
        continue
      if (!externalId || printedIds.has(externalId)) continue
      printedIds.add(externalId)
      const existing = byExternalId.get(externalId)
      if (existing?.some((item) => item.id === printing.id)) continue
      byExternalId.set(externalId, [...(existing ?? []), printing])
    }
  }
  const observations: NormalizedPriceObservation[] = []
  const rejected: PricingBatch['rejected'] = []
  for (const item of feed.observations) {
    const potentialMatches = byExternalId.get(item.providerProductId) ?? []
    const matches = potentialMatches.filter((printing) =>
      isCandidateMatch(item, printing),
    )
    if (matches.length !== 1) {
      rejected.push({
        providerProductId: item.providerProductId,
        ...(item.providerSkuId ? { providerSkuId: item.providerSkuId } : {}),
        reason: potentialMatches.length
          ? 'ambiguous-product'
          : 'unknown-product',
      })
      continue
    }
    observations.push({
      ...item,
      id: observationId(feed.provider, item),
      printingId: matches[0]!.id,
    })
  }
  observations.sort((a, b) => a.id.localeCompare(b.id))
  return {
    schemaVersion: 1,
    provider: feed.provider,
    externalIdKey: feed.externalIdKey,
    fetchedAt: feed.fetchedAt,
    catalogBuildId,
    currencyUnit: 'minor',
    observations,
    rejected,
  }
}

export async function ingestPricingFile(options: {
  input: string
  printings: string
  catalogBuildId: string
  output: string
}): Promise<PricingBatch> {
  const feed = JSON.parse(await readFile(options.input, 'utf8')) as unknown
  const printings = JSON.parse(
    await readFile(options.printings, 'utf8'),
  ) as CatalogPrinting[]
  const batch = normalizePricingFeed(feed, printings, options.catalogBuildId)
  await writeJson(options.output, batch)
  return batch
}
