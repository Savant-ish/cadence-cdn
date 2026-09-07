# Pricing ingestion

Pricing is an independent, append-oriented domain. It is not embedded in immutable catalog records because prices change frequently and have different licensing, retention, and availability requirements.

```text
authorized acquisition adapter
  -> provider pricing feed
  -> schema and monetary validation
  -> external-ID crosswalk
  -> immutable normalized batch
  -> operational price-history store
  -> current-price projection for cadence-web
```

## Contract

An acquisition adapter writes the provider-neutral format in `schemas/pricing-feed.schema.json`. The adapter is responsible for having permission to acquire and use its input data. The core pipeline does not crawl a provider, interpret HTML, or contain provider credentials.

Each feed declares `externalIdKey`, such as `tcgplayer.productId`. The resolver looks up that exact namespace on catalog printings and accepts an observation only when it maps to exactly one Cadence printing. Unknown and ambiguous mappings are retained in the batch rejection report rather than guessed.

All monetary values are non-negative integer minor units: USD 12.34 is `1234`. An observation also records its currency, retail/buylist channel, optional condition and finish, provider product/SKU IDs, observation timestamp, and optional attribution URL. The normalized batch records the catalog build ID used for resolution.

## CLI

Build the current catalog first, then normalize a feed:

```sh
npm run pricing:ingest -- \
  --input snapshots/pricing/provider/feed.json \
  --printings dist/games/pokemon/printings.json \
  --catalog-build-id <catalog-build-id> \
  --output pricing-batch.json
```

The generated batch is a transport/archive unit, not the long-term query model. A production store should enforce uniqueness by observation ID, preserve full history, and build a replaceable latest-price projection by printing, condition, finish, channel, currency, and price kind. Never overwrite historical observations.

## Provider adapters

Adapters belong outside the normalized core and should implement authentication, source-specific rate limits, retries, attribution, and licensing constraints. This permits official APIs, licensed bulk feeds, or manual imports to coexist without changing the Cadence pricing model.

### TCGCSV

TCGCSV is the first adapter. It checks `last-updated.txt`, uses the declared timestamp as the immutable snapshot release, fetches the selected category's groups and per-group price files, waits at least 100 ms between uncached data requests, sends an identifiable user agent, and resumes from already downloaded raw group files. It maps TCGCSV `productId` to `tcgplayer.productId`, preserves `subTypeName` as the finish variant, and converts USD decimal values to cents.

```sh
npm run pricing:fetch:tcgcsv -- \
  --category-id 3 \
  --output snapshots/pricing/tcgcsv \
  --user-agent "CadenceCatalog/0.1.0 (+https://cadencetcg.dev)"
```

`TCGCSV_USER_AGENT` may be used instead of the flag. Repeat the command for each required TCGCSV category. A rerun for the same daily timestamp reuses its raw files and reconstructs the feed without downloading them again. Do not schedule the sync more than once every 24 hours.
