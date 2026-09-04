# Cadence CDN

Provider-neutral catalog ingestion and deterministic publishing for Cadence. The MVP imports Pokemon singles from a pinned `tcgjson` snapshot and publishes Cadence-owned games, sets, cards, and printings.

Production catalog: <https://cdn.cadencetcg.dev/catalog/latest.json>

## Requirements

Node.js 22 or newer.

## Local workflow

```sh
npm ci
npm run catalog:fetch -- --provider tcgjson --game pokemon --release latest
npm run catalog:build -- --provider tcgjson --game pokemon --snapshot snapshots/tcgjson/<release>/pokemon/catalog.json
npm run catalog:validate -- --snapshot snapshots/tcgjson/<release>/pokemon/catalog.json
npm run catalog:verify-artifacts -- --manifest dist/manifest.json --root dist
npm run taxonomy:report -- --snapshot snapshots/tcgjson/<release>/pokemon/catalog.json
npm run verify
```

`latest` is resolved before download and saved in `release.json`. For production, pass a concrete tag such as `--release weekly-YYYYMMDD`. A fixture build uses the default snapshot:

```sh
npm run catalog:build
```

Use `--dry-run` to normalize and validate without writing output. Use `--previous-manifest path/to/manifest.json` to reject set/card/printing drops greater than 10%; `--allow-count-drop` is the explicit override. `--imported-at` is available for nonstandard release names, but reproducible builds must reuse the same value.

Pokemon era and set-kind assignments are maintained as reviewed Cadence taxonomy rather than inferred in consumers. See [taxonomy administration](docs/taxonomy-admin.md).

The CLI also provides `taxonomy:suggest`, `taxonomy:report`, `catalog:package-release`, and `catalog:publish-r2`. R2 publication is normally performed only by GitHub Actions; see [the R2 runbook](docs/r2-operations.md).

## Output and consumer contract

`dist/manifest.json` lists the schema version, content-derived build ID, pinned provider release, counts, artifact sizes, SHA-256 checksums, validation summary, and image policy. The output tree includes `games.json`, game-level sets/cards/printings files, a game index, per-set bundles, `import-report.json`, and `manifest.json`.

`cadence-web` should bootstrap from the production pointer, verify the immutable manifest and artifact checksums, and accept builds atomically. It must retain the previous accepted build on any update failure. See [the catalog contract](docs/catalog-schema.md) and [consumer integration protocol](docs/consumer-integration.md).

Raw snapshots, generated catalogs, and images are excluded from Git. Image URLs are reference metadata only; this project does not download, republish, or claim a license to artwork. See [the source policy](docs/source-policies/tcgjson.md).

Cloudflare storage is divided into a public catalog bucket, a reserved public derivatives bucket, and a private originals bucket. This foundation does not change the image policy: no provider images are stored in R2. See [the image asset lifecycle](docs/image-assets.md).

## Automated publication

CI verifies every push and pull request. The `Publish catalog` workflow runs each Monday at 08:30 UTC and can be dispatched manually with either `latest` or a pinned `tcgjson` release. It checks upstream size and SHA-256 metadata, rejects large record-count regressions, verifies every generated artifact, and rebuilds into a second directory to prove determinism.

Each accepted source release and Cadence schema combination becomes an immutable GitHub Release named `catalog-v<schema-version>-<provider-release>`. Consumers can use GitHub as a recovery source:

- `https://github.com/Savant-ish/cadence-cdn/releases/latest/download/latest.json`
- `https://github.com/Savant-ish/cadence-cdn/releases/latest/download/manifest.json`

The same workflow publishes unpacked JSON to R2 beneath `catalog/builds/<build-id>/` and atomically updates `catalog/latest.json`. Production GitHub Actions settings are:

- Variables: `R2_CATALOG_BUCKET=cadence-catalog-public` and `R2_PUBLIC_BASE_URL=https://cdn.cadencetcg.dev`.
- Secrets: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`.

The R2 account token has Object Read & Write access only to the catalog bucket. All `r2.dev` endpoints are disabled; `cdn.cadencetcg.dev` uses TLS 1.2+ and read-only browser CORS. Do not expose the private originals bucket. See [architecture](docs/architecture.md) for the full boundaries and guarantees.
