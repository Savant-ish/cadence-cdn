import type {
  CatalogCard,
  CatalogPrinting,
  CatalogSet,
  ImportContext,
  NormalizedCatalog,
} from '../../domain/catalog.js'
import {
  createIdentity,
  normalizeCollectorNumber,
  normalizeComponent,
} from '../../identity/cadence-id.js'
import { parseCatalog } from './types.js'
import type { TcgjsonProduct } from './types.js'

function optionalText(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value))
    return (
      value
        .filter((item): item is string => typeof item === 'string')
        .join(', ') || undefined
    )
  return undefined
}

function customAttributes(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!metadata) return {}
  const custom = metadata.customAttributes
  return custom && typeof custom === 'object' && !Array.isArray(custom)
    ? (custom as Record<string, unknown>)
    : metadata
}

function attribute(
  attrs: Record<string, unknown>,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const direct = optionalText(attrs[name])
    if (direct) return direct
    const key = Object.keys(attrs).find(
      (item) => item.toLowerCase() === name.toLowerCase(),
    )
    if (key) {
      const value = optionalText(attrs[key])
      if (value) return value
    }
  }
  return undefined
}

interface PrintingVariant {
  finish?: string
  edition?: string
}

const EDITION_PATTERN =
  /\b(?:\d+(?:st|nd|rd|th)?\s+edition|first\s+edition|unlimited)\b/i
const VARIANT_SPLIT_PATTERN = /\s*[;,/]\s*|\s*,\s*/
const EXTERNAL_ID_PREFIX = 'tcgplayer.productId'

function normalizeValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeEdition(value: string): string {
  const normalized = normalizeValue(value).toLowerCase()
  if (normalized === '1st edition' || normalized === 'first edition')
    return '1st Edition'
  if (normalized === 'unlimited') return 'Unlimited'
  if (normalized === '1st') return '1st Edition'
  return normalizeValue(value)
}

function splitVariantValues(value: string | undefined): string[] {
  return value
    ? value
        .split(VARIANT_SPLIT_PATTERN)
        .map((item) => item.trim())
        .filter(Boolean)
    : []
}

function parseFinishAndEdition(value: string): PrintingVariant {
  const normalized = normalizeValue(value)
  const match = normalized.match(EDITION_PATTERN)
  if (!match) return { finish: normalized }
  const finish = normalizeValue(normalized.replace(match[0], ''))
  return {
    edition: normalizeEdition(match[0]),
    ...(finish ? { finish } : {}),
  }
}

function buildVariants(
  rawFinish: string | undefined,
  rawEdition: string | undefined,
): PrintingVariant[] {
  const explicitEditions = splitVariantValues(rawEdition).map(normalizeEdition)
  const finishValues = splitVariantValues(rawFinish)
  const variants: PrintingVariant[] = []
  const seen = new Set<string>()
  const sourceFinishes =
    finishValues.length > 0 ? finishValues : [undefined as string | undefined]
  for (const rawFinishValue of sourceFinishes) {
    const parsed = rawFinishValue ? parseFinishAndEdition(rawFinishValue) : {}
    const editions =
      explicitEditions.length > 0
        ? explicitEditions
        : parsed.edition
          ? [parsed.edition]
          : []
    for (const edition of editions.length ? editions : [undefined]) {
      const finish = parsed.finish
      const key = `${edition ?? ''}|${finish ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      const variant: PrintingVariant = {}
      if (edition) variant.edition = edition
      if (finish) variant.finish = finish
      variants.push(variant)
    }
  }
  if (!variants.length) variants.push({})
  variants.sort(
    (a, b) =>
      `${a.edition ?? ''}`.localeCompare(`${b.edition ?? ''}`) ||
      `${a.finish ?? ''}`.localeCompare(`${b.finish ?? ''}`),
  )
  return variants
}

function deduplicatePrintings(printings: CatalogPrinting[]): CatalogPrinting[] {
  const byId = new Map<string, CatalogPrinting>()
  for (const printing of printings) {
    const existing = byId.get(printing.id)
    if (!existing) {
      byId.set(printing.id, printing)
      continue
    }
    if (JSON.stringify(existing) !== JSON.stringify(printing)) {
      throw new Error(
        `tcgjson products conflict on canonical printing identity: ${printing.id}`,
      )
    }
  }
  return [...byId.values()]
}

export function isPokemonCodeCard(product: TcgjsonProduct): boolean {
  const name = optionalText(product.cleanName) ?? optionalText(product.name)
  const attrs = customAttributes(product.metadata)
  const rarity =
    optionalText(product.rarity) ?? attribute(attrs, 'rarityDbName', 'rarity')
  return (
    /^code card(?:\s*-|$)/i.test(name ?? '') ||
    rarity?.toLowerCase() === 'code card'
  )
}

export async function mapPokemon(
  input: unknown,
  context: ImportContext,
): Promise<NormalizedCatalog> {
  return mapTcgjsonGame(input, context, {
    slug: 'pokemon',
    name: 'Pokémon',
    excludeProduct: isPokemonCodeCard,
  })
}

export async function mapLorcana(
  input: unknown,
  context: ImportContext,
): Promise<NormalizedCatalog> {
  return mapTcgjsonGame(input, context, {
    slug: 'lorcana',
    name: 'Disney Lorcana',
  })
}

export async function mapOnePiece(
  input: unknown,
  context: ImportContext,
): Promise<NormalizedCatalog> {
  return mapTcgjsonGame(input, context, {
    slug: 'onepiece',
    name: 'One Piece Card Game',
  })
}

async function mapTcgjsonGame(
  input: unknown,
  context: ImportContext,
  options: {
    slug: string
    name: string
    excludeProduct?: (product: TcgjsonProduct) => boolean
  },
): Promise<NormalizedCatalog> {
  const source = parseCatalog(input)
  const gameIdentity = createIdentity('game', options.slug)
  const game = { ...gameIdentity, slug: options.slug, name: options.name }
  const retainedProducts = source.products.filter(
    (product) => !options.excludeProduct?.(product),
  )
  const sourceSetsWithProducts = new Set(
    source.products
      .map((product) => optionalText(product.setId ?? product.groupId))
      .filter((value): value is string => Boolean(value)),
  )
  const retainedSetIds = new Set(
    retainedProducts
      .map((product) => optionalText(product.setId ?? product.groupId))
      .filter((value): value is string => Boolean(value)),
  )
  const sourceSets = source.sets
    .filter((set) => {
      const externalId = optionalText(set.setId)
      return (
        !externalId ||
        !sourceSetsWithProducts.has(externalId) ||
        retainedSetIds.has(externalId)
      )
    })
    .sort((a, b) => String(a.setId).localeCompare(String(b.setId)))
  const setByExternalId = new Map<string, CatalogSet>()

  for (const item of sourceSets) {
    const externalId = optionalText(item.setId)
    const name = optionalText(item.name)
    if (!externalId || !name)
      throw new Error('tcgjson set is missing setId or name')
    const code = optionalText(item.abbreviation) ?? optionalText(item.code)
    const iconUrl = optionalText(item.iconUrl)
    const releaseDate = optionalText(
      item.publishedOn ?? item.releaseDate,
    )?.slice(0, 10)
    // Names are the durable key: tcgjson abbreviations are not unique (for example, PR).
    const identity = createIdentity('set', options.slug, name)
    setByExternalId.set(externalId, {
      ...identity,
      gameId: game.id,
      ...(code ? { code } : {}),
      name,
      ...(releaseDate ? { releaseDate } : {}),
      image: iconUrl
        ? { sourceUrl: iconUrl, status: 'reference-only' as const }
        : { status: 'unavailable' as const },
    })
  }

  const cards = new Map<string, CatalogCard>()
  const sourcePrintings = retainedProducts
    .sort((a, b) => String(a.productId).localeCompare(String(b.productId)))
    .flatMap((product) => {
      const externalId = optionalText(product.productId)
      const name = optionalText(product.cleanName) ?? optionalText(product.name)
      const sourceSetId =
        optionalText(product.setId) ?? optionalText(product.groupId)
      const set = sourceSetId ? setByExternalId.get(sourceSetId) : undefined
      const attrs = customAttributes(product.metadata)
      const collectorNumber =
        optionalText(product.number) ??
        optionalText(product.collectorNumber) ??
        attribute(attrs, 'number', 'cardNumber')
      if (!externalId || !name || !set) {
        throw new Error(
          `tcgjson product ${externalId ?? '<unknown>'} lacks productId, name, or a known set`,
        )
      }
      const normalizedName = normalizeComponent(name)
      const cardIdentity = createIdentity('card', options.slug, normalizedName)
      if (!cards.has(cardIdentity.id)) {
        const cardType =
          optionalText(product.productTypeName) ??
          attribute(attrs, 'cardType', 'stage')
        cards.set(cardIdentity.id, {
          ...cardIdentity,
          gameId: game.id,
          name,
          normalizedName,
          ...(cardType ? { cardType } : {}),
          ...(Object.keys(attrs).length ? { metadata: attrs } : {}),
        })
      }
      const language =
        optionalText(product.language) ?? attribute(attrs, 'language') ?? 'en'
      const finish =
        optionalText(product.finish) ??
        optionalText(product.foilings) ??
        attribute(attrs, 'finish', 'printing')
      const edition =
        optionalText(product.edition) ?? attribute(attrs, 'edition')
      const sourceUrl = optionalText(product.url)
      const imageUrl =
        optionalText(product.imageUrl) ??
        product.imageUrls?.find((url) => Boolean(url))
      const rarity = optionalText(product.rarity) ?? attribute(attrs, 'rarity')
      const variants = buildVariants(finish, edition)
      const collectorIdentity = collectorNumber
        ? normalizeCollectorNumber(collectorNumber)
        : `unnumbered-${normalizedName}`
      return variants.map((variant) => {
        const printingIdentity = createIdentity(
          'printing',
          options.slug,
          set.identityKey,
          normalizedName,
          collectorIdentity,
          language,
          variant.edition ?? 'standard',
          variant.finish ?? 'standard',
        )
        const hasMultipleVariants = variants.length > 1
        const finishKey = variant.finish ? variant.finish : 'standard'
        const editionKey = variant.edition ? variant.edition : 'standard'
        const variantKey = `${EXTERNAL_ID_PREFIX}:${editionKey}:${finishKey}`
        const externalIds: Record<string, string> = {
          ...(hasMultipleVariants ? {} : { [EXTERNAL_ID_PREFIX]: externalId }),
          [variantKey]: externalId,
        }
        return {
          ...printingIdentity,
          cardId: cardIdentity.id,
          setId: set.id,
          ...(collectorNumber ? { collectorNumber } : {}),
          ...(rarity ? { rarity } : {}),
          language,
          ...(variant.finish ? { finish: variant.finish } : {}),
          ...(variant.edition ? { edition: variant.edition } : {}),
          image: imageUrl
            ? { sourceUrl: imageUrl, status: 'reference-only' as const }
            : { status: 'unavailable' as const },
          externalIds,
          provenance: {
            provider: 'tcgjson',
            release: context.release.id,
            ...(sourceUrl ? { sourceUrl } : {}),
            importedAt: context.importedAt,
          },
        }
      })
    })

  return {
    games: [game],
    sets: [...setByExternalId.values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    cards: [...cards.values()].sort((a, b) => a.id.localeCompare(b.id)),
    printings: deduplicatePrintings(sourcePrintings).sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
  }
}
