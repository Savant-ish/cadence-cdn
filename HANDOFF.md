# Cadence CDN handoff

## Current state

The multi-game card catalog is implemented for Pokémon, Disney Lorcana, and One Piece Card Game. The pipeline resolves a pinned weekly `tcgjson` release, verifies source downloads, normalizes them into Cadence-owned records, validates identity and references, emits deterministic JSON, and publishes through GitHub Releases and Cloudflare R2.

Production entry point: <https://cdn.cadencetcg.dev/catalog/latest.json>

The current public schema is `1.2.0`; identity normalization is `v1`. Consumers must discover the current immutable build through `latest.json`, validate the supported schema version, fetch only manifest-declared artifacts, and verify byte sizes and SHA-256 checksums before atomically accepting a build.

## Implemented capabilities

- Game registry and `tcgjson` adapters for Pokémon, Disney Lorcana, and One Piece Card Game.
- Stable Cadence game, set, card, and printing IDs independent of provider IDs.
- Conceptual-card and printing separation; inventory should reference printing IDs.
- Source provenance and external-ID crosswalks.
- Set and printing image-reference metadata with explicit policy status.
- Conservative exclusion of digital Pokemon code-card listings.
- Set image URL extraction from catalog metadata.
- Curated Pokemon era/set-kind taxonomy queue and reporting tools.
- Versioned catalog change sets with bulk selectors, protected fields, draft previews, approval metadata, and checksum-bound application reporting.
- Deterministic per-game, aggregate, and per-set artifacts.
- Validation for collisions, broken references, ambiguous external IDs, count regressions, and unapproved image-license claims.
- Provider-neutral pricing feed validation and external-ID-to-printing resolution with immutable observation IDs and rejection reporting.
- Resumable, throttled daily TCGCSV pricing acquisition with raw snapshot retention and TCGplayer product-ID mapping.
- Sharded immutable pricing artifacts, public byte verification, and an independent atomic R2 pricing pointer.
- Daily GitHub pricing publication resolved against a checksum-verified copy of the currently accepted catalog printings.
- GitHub Actions CI, scheduled weekly ingestion, deterministic rebuild proof, GitHub Release packaging, and atomic R2 publication.

## Cloudflare deployment

- Public catalog bucket: `cadence-catalog-public`
- Reserved public licensed-assets bucket: `cadence-assets-public`
- Private owned-originals bucket: `cadence-assets-originals`
- Catalog hostname: `cdn.cadencetcg.dev`, TLS 1.2 minimum
- All managed `r2.dev` endpoints: disabled
- Catalog CORS: public `GET` and `HEAD` only

The catalog workflow uses a bucket-scoped account token stored in GitHub repository secrets. Immutable objects live at `catalog/builds/<build-id>/`; `catalog/latest.json` is written only after all build objects upload and verify successfully. GitHub Releases remain the independent archive and recovery channel.

See [R2 operations](docs/r2-operations.md) for credentials, publication, verification, and recovery.

## Deliberate limitations

- Pricing originally lived here because TCGCSV catalog imports included price fields. `cadence-pricing` now owns daily price acquisition, immutable observations, and valuation publication, currently for Pokemon. The implementation here is a compatibility bridge and should be removed only after the replacement path is verified in production. `cadence-cdn` remains the authoritative catalog and stable-ID/crosswalk publisher.
- Sealed products are a separate catalog domain owned here. TCGCSV products are the planned initial discovery source; they require conservative classification and independent product/configuration identities.
- All upstream TCGplayer card and set URLs are `reference-only`. They are not mirrored to R2 or represented as licensed.
- Owned-image ingestion, R2 derivative publication, verification, provenance recording, and draft substitution are implemented. See [image assets](docs/image-assets.md).
- Pokemon taxonomy suggestions remain unpublished until individually approved. Normal builds tolerate unclassified sets; `--require-approved-taxonomy` is the future strict-production gate.

## Next work

1. Make `config/admin/image-assets.json` authoritative for licensed-image validation, update the manifest image policy, review a schema bump, and activate `assets.cadencetcg.dev`.
2. Implement the TCGCSV sealed-product candidate importer, classifier/review queue, product/configuration identities, schema, validation, and artifacts.
3. Review the 219 pending Pokémon era/set-kind assignments.
4. Add further TCGs one at a time with dedicated fixtures, validation, and source policies.
5. Retire the historical pricing bridge only after `cadence-pricing` has a verified compatible replacement for every consumer still using it.

Do not download or republish provider images while implementing later phases. Every public owned asset must have recorded rights provenance and an explicit approval step.
