# Cadence CDN

Provider-neutral catalog ingestion and deterministic publishing for Cadence. The MVP imports Pokémon singles from a pinned `tcgjson` snapshot and publishes Cadence-owned games, sets, cards, and printings.

## Requirements

Node.js 22 or newer.

## Local workflow

```sh
npm ci
npm run catalog:fetch -- --provider tcgjson --game pokemon --release latest
npm run catalog:build -- --provider tcgjson --game pokemon --snapshot snapshots/tcgjson/<release>/pokemon/catalog.json
npm run catalog:validate -- --snapshot snapshots/tcgjson/<release>/pokemon/catalog.json
npm run catalog:verify-artifacts -- --manifest dist/manifest.json --root dist
npm run verify
```

`latest` is resolved before download and saved in `release.json`. For production, pass a concrete tag such as `--release weekly-YYYYMMDD`. A fixture build uses the default snapshot:

```sh
npm run catalog:build
```

Use `--dry-run` to normalize and validate without writing output. Use `--previous-manifest path/to/manifest.json` to reject set/card/printing drops greater than 10%; `--allow-count-drop` is the explicit override. `--imported-at` is available for nonstandard release names, but reproducible builds must reuse the same value.

Pokémon era and set-kind assignments are maintained as reviewed Cadence taxonomy rather than inferred in consumers. See [taxonomy administration](docs/taxonomy-admin.md).

## Output

`dist/manifest.json` lists the schema version, content-derived build ID, pinned provider release, counts, artifact sizes, SHA-256 checksums, validation summary, and image policy. `cadence-web` should verify these checksums and consume only these Cadence records.

Raw snapshots, generated catalogs, and images are excluded from Git. Image URLs are reference metadata only; this project does not download, republish, or claim a license to artwork. See [the source policy](docs/source-policies/tcgjson.md).

## Automated publication

CI verifies every push and pull request. The `Publish catalog` workflow runs each Monday and can be dispatched manually with either `latest` or a pinned `tcgjson` release. It checks upstream size and SHA-256 metadata, rejects large record-count regressions, verifies every generated artifact, and rebuilds into a second directory to prove determinism.

Each accepted source release and Cadence schema combination becomes an immutable GitHub Release named `catalog-v<schema-version>-<provider-release>`. The release contains the catalog archive, manifest, import report, checksums, and `latest.json`. Consumers can bootstrap from these stable URLs:

- `https://github.com/Savant-ish/cadence-cdn/releases/latest/download/latest.json`
- `https://github.com/Savant-ish/cadence-cdn/releases/latest/download/manifest.json`

The pointer contains immutable asset URLs and the archive checksum. Existing release tags are never overwritten. A count-regression override is available only through the manual workflow input and remains visible in the workflow history.

When R2 repository settings are present, the same workflow also publishes unpacked JSON to `catalog/builds/<build-id>/` and atomically updates `catalog/latest.json`. Configure these GitHub Actions settings:

- Variables: `R2_CATALOG_BUCKET` (`cadence-catalog-public`) and `R2_PUBLIC_BASE_URL` (the bucket's production custom-domain URL).
- Secrets: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`.

The R2 token should have Object Read & Write access only to the catalog bucket. Do not use the public development URL for production traffic, and do not expose the private originals bucket. See [architecture](docs/architecture.md) for the bucket boundaries and publication guarantees.
