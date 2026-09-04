import type {
  CatalogCard,
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

export async function mapPokemon(
  input: unknown,
  context: ImportContext,
): Promise<NormalizedCatalog> {
  const source = parseCatalog(input)
  const gameIdentity = createIdentity('game', 'pokemon')
  const game = { ...gameIdentity, slug: 'pokemon', name: 'Pokémon' }
  const sourceSets = [...source.sets].sort((a, b) =>
    String(a.setId).localeCompare(String(b.setId)),
  )
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
    const identity = createIdentity('set', 'pokemon', name)
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
  const printings = [...source.products]
    .sort((a, b) => String(a.productId).localeCompare(String(b.productId)))
    .map((product) => {
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
      const cardIdentity = createIdentity('card', 'pokemon', normalizedName)
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
      const variant = [finish, edition].filter(Boolean).join('-') || 'standard'
      const printingIdentity = createIdentity(
        'printing',
        'pokemon',
        set.identityKey,
        normalizedName,
        collectorNumber
          ? normalizeCollectorNumber(collectorNumber)
          : `unnumbered-${normalizedName}`,
        language,
        variant,
      )
      const sourceUrl = optionalText(product.url)
      const imageUrl =
        optionalText(product.imageUrl) ??
        product.imageUrls?.find((url) => Boolean(url))
      const rarity = optionalText(product.rarity) ?? attribute(attrs, 'rarity')
      return {
        ...printingIdentity,
        cardId: cardIdentity.id,
        setId: set.id,
        ...(collectorNumber ? { collectorNumber } : {}),
        ...(rarity ? { rarity } : {}),
        language,
        ...(finish ? { finish } : {}),
        ...(edition ? { edition } : {}),
        image: imageUrl
          ? { sourceUrl: imageUrl, status: 'reference-only' as const }
          : { status: 'unavailable' as const },
        externalIds: { 'tcgplayer.productId': externalId },
        provenance: {
          provider: 'tcgjson',
          release: context.release.id,
          ...(sourceUrl ? { sourceUrl } : {}),
          importedAt: context.importedAt,
        },
      }
    })

  return {
    games: [game],
    sets: [...setByExternalId.values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    cards: [...cards.values()].sort((a, b) => a.id.localeCompare(b.id)),
    printings: printings.sort((a, b) => a.id.localeCompare(b.id)),
  }
}
