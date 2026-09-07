# TCGCSV catalog source policy

- Intended catalog use: sealed-product discovery and external-ID crosswalks
- Upstream shape: TCGplayer categories, groups, products, and parallel product-level prices
- Product scope: individual cards, sealed products, and other merchandise may coexist
- Stable provider crosswalk: retain TCGplayer `productId` when present
- Images: URL metadata only and `reference-only`; never mirror provider images
- Prices: owned by `cadence-pricing`, not the sealed catalog
- SKUs: TCGCSV does not expose the TCGplayer SKU collection, so exact configuration/condition coverage is incomplete
- Classification: conservative rules plus reviewed overrides; unmatched products are never assumed sealed
- Acquisition: check `last-updated.txt`, fetch at most daily, use an identifiable user agent, throttle requests by at least 100 ms, cache raw responses, and support resume

Raw snapshots remain ignored and immutable. The importer must record the TCGCSV update timestamp, source URLs, byte size, and SHA-256 for reproducibility. Unknown, ambiguous, code, and unsupported products must be reported separately.

TCGCSV redistributes provider-derived catalog data. This source policy records engineering constraints and does not grant artwork, dataset, trademark, or commercial rights.
