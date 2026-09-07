export const PRICING_SCHEMA_VERSION = 1

export type PriceChannel = 'retail' | 'buylist'

export interface ProviderPriceFeed {
  schemaVersion: 1
  provider: string
  externalIdKey: string
  fetchedAt: string
  observations: ProviderPriceObservation[]
}

export interface ProviderPriceObservation {
  providerProductId: string
  providerSkuId?: string
  observedAt: string
  currency: string
  condition?: string
  finish?: string
  channel: PriceChannel
  prices: {
    market?: number
    low?: number
    mid?: number
    high?: number
  }
  sourceUrl?: string
}

export interface NormalizedPriceObservation extends ProviderPriceObservation {
  id: string
  printingId: string
}

export interface PricingBatch {
  schemaVersion: 1
  provider: string
  externalIdKey: string
  fetchedAt: string
  catalogBuildId: string
  currencyUnit: 'minor'
  observations: NormalizedPriceObservation[]
  rejected: Array<{
    providerProductId: string
    providerSkuId?: string
    reason: 'unknown-product' | 'ambiguous-product'
  }>
}
