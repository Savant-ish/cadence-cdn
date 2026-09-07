import test from 'node:test'
import assert from 'node:assert/strict'
import type { CatalogPrinting } from '../src/domain/catalog.js'
import {
  normalizePricingFeed,
  validateProviderPriceFeed,
} from '../src/pricing/ingest.js'

const printing = (id: string, productId: string): CatalogPrinting => ({
  id,
  identityKey: `v1:${id}`,
  cardId: 'cadence:card:test',
  setId: 'cadence:set:test',
  language: 'en',
  externalIds: { 'tcgplayer.productId': productId },
  provenance: {
    provider: 'fixture',
    release: 'fixture',
    importedAt: '2026-09-07T00:00:00Z',
  },
})

const feed = {
  schemaVersion: 1,
  provider: 'example-prices',
  externalIdKey: 'tcgplayer.productId',
  fetchedAt: '2026-09-07T12:00:00Z',
  observations: [
    {
      providerProductId: '704848',
      providerSkuId: 'sku-1',
      observedAt: '2026-09-07T11:59:00Z',
      currency: 'USD',
      condition: 'near-mint',
      finish: 'normal',
      channel: 'retail',
      prices: { market: 1234, low: 1100 },
      sourceUrl: 'https://example.test/product/704848',
    },
    {
      providerProductId: 'missing',
      observedAt: '2026-09-07T11:59:00Z',
      currency: 'USD',
      channel: 'retail',
      prices: { market: 999 },
    },
  ],
}

test('resolves provider observations to stable printing IDs', () => {
  const batch = normalizePricingFeed(
    feed,
    [printing('cadence:printing:test', '704848')],
    'catalog-build-1',
  )
  assert.equal(batch.observations.length, 1)
  assert.equal(batch.observations[0]?.printingId, 'cadence:printing:test')
  assert.equal(batch.observations[0]?.prices.market, 1234)
  assert.equal(batch.currencyUnit, 'minor')
  assert.deepEqual(batch.rejected, [
    { providerProductId: 'missing', reason: 'unknown-product' },
  ])
})

test('rejects ambiguous product mappings rather than guessing', () => {
  const batch = normalizePricingFeed(
    { ...feed, observations: [feed.observations[0]] },
    [
      printing('cadence:printing:a', '704848'),
      printing('cadence:printing:b', '704848'),
    ],
    'catalog-build-1',
  )
  assert.equal(batch.observations.length, 0)
  assert.equal(batch.rejected[0]?.reason, 'ambiguous-product')
})

test('requires integer minor-unit prices', () => {
  assert.throws(
    () =>
      validateProviderPriceFeed({
        ...feed,
        observations: [{ ...feed.observations[0], prices: { market: 12.34 } }],
      }),
    /minor currency units/,
  )
})
