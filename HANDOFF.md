# Cadence CDN handoff

## Current state

The Pokemon catalog MVP is implemented and operating. The pipeline resolves a pinned weekly `tcgjson` release, verifies the source download when metadata is available, normalizes it into Cadence-owned records, validates identity and references, emits deterministic JSON, and publishes through both GitHub Releases and Cloudflare R2.

Production entry point: <https://cdn.cadencetcg.dev/catalog/latest.json>

The current public schema is `1.2.0`; identity normalization is `v1`. Consumers must discover the current immutable build through `latest.json`, validate the supported schema version, fetch only manifest-declared artifacts, and verify byte sizes and SHA-256 checksums before atomically accepting a build.

## Implemented capabilities

- Provider boundary with a `tcgjson` Pokemon adapter.
- Stable Cadence game, set, card, and printing IDs independent of provider IDs.
- Conceptual-card and printing separation; inventory should reference printing IDs.
- Source provenance and external-ID crosswalks.
- Set and printing image-reference metadata with explicit policy status.
- Set image URL extraction from catalog metadata.
- Curated Pokemon era/set-kind taxonomy queue and reporting tools.
- Deterministic per-game, aggregate, and per-set artifacts.
- Validation for collisions, broken references, ambiguous external IDs, count regressions, and unapproved image-license claims.
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

- Pokemon is the only normalized game today, although the schema and provider boundary are multi-TCG oriented.
- Pricing, inventory, marketplace listings, and sealed products are out of scope.
- All upstream TCGplayer card and set URLs are `reference-only`. They are not mirrored to R2 or represented as licensed.
- The owned-image ingestion and substitution workflow is designed but not implemented. See [image assets](docs/image-assets.md).
- Pokemon taxonomy suggestions remain unpublished until individually approved. Normal builds tolerate unclassified sets; `--require-approved-taxonomy` is the future strict-production gate.

## Next work

1. Integrate `cadence-web` using [the consumer contract](docs/consumer-integration.md).
2. Build admin review for Pokemon taxonomy and owned image substitutions.
3. Define licensed-asset metadata and implement an audited promotion pipeline from private originals to public derivatives.
4. Add TCGs one at a time with dedicated adapters, fixtures, validation, and source policies.
5. Model sealed products independently from singles.

Do not download or republish provider images while implementing later phases. Every public owned asset must have recorded rights provenance and an explicit approval step.
