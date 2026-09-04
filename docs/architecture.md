# Architecture

## Pipeline boundaries

The system separates provider acquisition, provider-specific mapping, Cadence validation, deterministic artifact generation, and publication. Only code under `src/providers/tcgjson/` understands `tcgjson` shapes. Downstream consumers receive only Cadence records.

```text
tcgjson release manifest
  -> verified ignored snapshot
  -> Pokemon adapter
  -> Cadence games / sets / cards / printings
  -> validation and taxonomy application
  -> deterministic dist tree and manifest
  -> GitHub Release + Cloudflare R2
  -> cadence-web
```

Raw downloads live under ignored `snapshots/`. Generated `dist/`, `build/`, and `release-assets/` trees are also ignored. Only source, schemas, curated configuration, small fixtures, tests, and documentation belong in Git.

## Identity and domain model

A card is a conceptual identity; a printing is the set-, number-, language-, and variant-specific inventory identity. Provider IDs remain external cross-references. Identity normalization is versioned as `v1`, and consumers must use opaque `id` values rather than reconstructing them from `identityKey`.

Published IDs must never be reinterpreted. A future normalization change requires a new identity version plus aliases or a migration map.

## Artifact generation

Each build emits `games.json`, a game index, game-level sets/cards/printings files, per-set files, `import-report.json`, and `manifest.json`. Artifact JSON is stably sorted and serialized. The 16-character build ID is derived from the ordered artifact descriptors, and the manifest records every consumer artifact's path, byte length, record count, and SHA-256 digest.

The build fails for invalid catalogs. Warnings—including missing optional values and unclassified sets—remain visible in `import-report.json`. A previous manifest can enforce the default 10% count-regression limit.

## Publication topology

Cloudflare R2 is the primary unpacked origin. GitHub Releases provide immutable archives, checksums, release metadata, and a separate recovery path.

| Resource                   | Exposure                     | Purpose                              |
| -------------------------- | ---------------------------- | ------------------------------------ |
| `cadence-catalog-public`   | `https://cdn.cadencetcg.dev` | Normalized catalog JSON              |
| `cadence-assets-public`    | No domain yet                | Future approved public derivatives   |
| `cadence-assets-originals` | Private                      | Future legally owned source captures |

All Cloudflare-managed `r2.dev` endpoints are disabled. The catalog hostname requires TLS 1.2 or newer. Its CORS policy permits public `GET` and `HEAD` requests and exposes ETag, length, type, and cache-control headers.

R2 publication writes the complete tree under `catalog/builds/<build-id>/` with `public, max-age=31536000, immutable`. Every object stores its SHA-256 digest as R2 metadata and is verified with `HEAD`. An existing immutable key is accepted only if its digest matches; a conflict aborts publication. The publisher then writes `catalog/latest.json` last with `public, max-age=60, must-revalidate`.

The GitHub Actions credential is an account token scoped to Object Read & Write on `cadence-catalog-public` only. Asset pipelines must use distinct credentials. See [R2 operations](r2-operations.md).

## Image and taxonomy policy

Provider card and set URLs are descriptive references, never mirrored assets. The validator rejects `licensed` status because no approved image source policy exists yet. Owned originals and public derivatives will use separate storage and an explicit provenance/approval process described in [image assets](image-assets.md).

Pokemon era and set-kind data is curated configuration. Suggestions are non-authoritative and pending assignments are omitted from published set records. See [taxonomy administration](taxonomy-admin.md).
