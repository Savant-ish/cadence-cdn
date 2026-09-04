# Architecture

The pipeline has four boundaries: a provider resolves and fetches immutable source snapshots; an adapter maps provider fields to the Cadence domain; validation rejects unsafe catalogs; and the publisher emits provider-neutral artifacts. Only the adapter imports `tcgjson` types.

Raw downloads live under ignored `snapshots/`. `dist/` is generated and ignored. Publication should copy a completed `dist/` tree to versioned object storage only after validation succeeds.

## R2 publication

Cloudflare R2 is the primary unpacked catalog origin while GitHub Releases remain an independent archive and recovery path. A publication writes the complete verified tree beneath `catalog/builds/<build-id>/` with a one-year immutable cache policy. It verifies each upload and writes `catalog/latest.json` last with a 60-second cache policy. Existing immutable keys may be reused only when their SHA-256 metadata matches; a conflicting object aborts publication.

Use separate buckets for each security and lifecycle boundary:

- `cadence-catalog-public` for normalized catalog JSON.
- `cadence-assets-public` for legally approved, public derivative assets.
- `cadence-assets-originals` for private owned source captures. Never connect this bucket to a public domain.

Provider image URLs remain reference metadata. The R2 publisher does not fetch or mirror them.

For production, connect the two public buckets to custom domains. Cloudflare's `r2.dev` endpoint is rate-limited and intended only for development. Scope the catalog CI credential to Object Read & Write on `cadence-catalog-public` only; asset ingestion should use separate credentials.

Identity normalization is versioned as `v1`. Published identifiers must never be reinterpreted. A future normalization change requires a new version and an alias or migration map.
