# Cloudflare R2 operations

## Live configuration

- Account ID is stored as GitHub repository secret `R2_ACCOUNT_ID`.
- Catalog bucket: `cadence-catalog-public`
- Catalog base URL: `https://cdn.cadencetcg.dev`
- Public pointer: `https://cdn.cadencetcg.dev/catalog/latest.json`
- Minimum TLS: 1.2
- Public development (`r2.dev`) access: disabled
- CORS: origins `*`, methods `GET` and `HEAD`

The other buckets are `cadence-assets-public` and private `cadence-assets-originals`. Neither currently has a custom domain. Never enable a public domain or `r2.dev` for the originals bucket.

## GitHub Actions settings

Repository variables:

- `R2_CATALOG_BUCKET=cadence-catalog-public`
- `R2_PUBLIC_BASE_URL=https://cdn.cadencetcg.dev`

Repository secrets:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

Use an R2 Account API token named for GitHub Actions with Object Read & Write access restricted to `cadence-catalog-public`. Do not reuse it for asset ingestion, local development, or another repository. Rotate it in Cloudflare and GitHub together; never commit or print either credential.

## Publication

`.github/workflows/publish-catalog.yml` runs Mondays at 08:30 UTC and supports manual dispatch with a `latest` or pinned release. It verifies source metadata, performs catalog validation, proves deterministic output with a second build, packages a GitHub Release, and then calls `catalog:publish-r2`.

Manual local R2 publication is available for recovery, but normally use GitHub Actions:

```sh
npm run catalog:publish-r2 -- \
  --root dist \
  --bucket cadence-catalog-public \
  --public-base-url https://cdn.cadencetcg.dev
```

The command reads `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` from the environment. Do not place credential values in shell history. Publication is idempotent for an identical build and refuses conflicting immutable objects. Before moving the pointer, it fetches every build object through the public hostname and verifies exact bytes and SHA-256; this catches storage/CDN delivery failures that an authenticated R2 `HEAD` cannot detect.

## Verification and recovery

After publication:

1. Fetch `catalog/latest.json` and require HTTP 200.
2. Fetch its `manifestUrl`; confirm matching build and schema versions.
3. Confirm the pointer uses a short cache policy and the manifest is immutable.
4. Verify representative manifest-declared artifacts and their checksums.
5. Review the GitHub Actions run and its retained diagnostic artifact.

If R2 publication fails, the pointer is not updated and consumers retain the prior build. Fix the failure and rerun the workflow. Never overwrite or delete a conflicting build prefix as a shortcut; investigate why the same build ID produced different bytes. GitHub Releases remain available as the recovery source.

The zone has a Cache Everything rule for `cdn.cadencetcg.dev` so JSON responses honor the origin cache directives. Immutable builds use a one-year edge/browser lifetime; the mutable pointer uses 60 seconds. A 5xx response must never be accepted as catalog data. Capture its `CF-RAY`, affected path, and timestamp when investigating Cloudflare delivery failures.
