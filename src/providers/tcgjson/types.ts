export interface TcgjsonSet {
  setId: number | string
  name: string
  abbreviation?: string
  code?: string
  publishedOn?: string
  releaseDate?: string
}

export interface TcgjsonProduct {
  productId: number | string
  name: string
  cleanName?: string
  setId?: number | string
  groupId?: number | string
  number?: string
  collectorNumber?: string
  rarity?: string
  foilings?: string[]
  url?: string
  imageUrl?: string
  imageUrls?: string[]
  language?: string
  finish?: string
  edition?: string
  productTypeName?: string
  metadata?: Record<string, unknown>
}

export interface TcgjsonCatalog {
  name?: string
  slug?: string
  updatedAt?: string
  sets: TcgjsonSet[]
  products: TcgjsonProduct[]
}

export function parseCatalog(input: unknown): TcgjsonCatalog {
  if (input === null || typeof input !== 'object')
    throw new Error('tcgjson catalog must be an object')
  const value = input as Record<string, unknown>
  if (!Array.isArray(value.sets) || !Array.isArray(value.products)) {
    throw new Error('tcgjson catalog must contain sets and products arrays')
  }
  return value as unknown as TcgjsonCatalog
}
