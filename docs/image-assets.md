# Image asset lifecycle

## Current behavior

`tcgjson` supplies TCGplayer-hosted card and set image URLs. The mapper retains these only as `sourceUrl` metadata with `status: "reference-only"`; the pipeline does not fetch, copy, optimize, or publish those files. URLs may be missing, incorrect, low quality, or removed upstream.

The validator rejects a `licensed` status until an approved source policy exists. This is an engineering safeguard, not a legal determination.

## Storage boundaries

- `cadence-assets-originals` is private storage for legally sourced original captures.
- `cadence-assets-public` stores approved web derivatives.
- Catalog JSON remains in `cadence-catalog-public` and should reference only approved public asset records when substitution is implemented.

The intended public endpoint for `cadence-assets-public` is `https://assets.cadencetcg.dev`. The originals bucket must never receive a public custom domain or `r2.dev` access.

## Promotion workflow

An owned image must not become active catalog content merely because a file was uploaded. Admin tooling records the game, entity type and Cadence ID, source/creator, capture date, rights basis, original digest, reviewer, approval time, derivative recipe, and derivative digest. Supersession history and catalog activation remain outstanding.

The lifecycle is:

```text
legally sourced capture
  -> private immutable original
  -> metadata and rights declaration/review
  -> deterministic web derivatives
  -> public asset publication
  -> draft catalog substitution
  -> registry-aware catalog approval (outstanding)
```

Substitutions should preserve history and support rollback. Public keys should be content-addressed or versioned and cacheable as immutable. Catalog records should distinguish the active Cadence-owned asset from a provider reference; provider URLs remain useful for reconciliation but are not the fallback authority.

Use separate, bucket-scoped credentials for capture, review/promotion, and catalog publication. Multi-TCG support belongs in asset metadata and key structure rather than separate ad hoc pipelines per game.

## Local automated publication

Start the workbench with `npm run admin:serve`, select exactly one set or card printing, and complete **Publish legally sourced image to R2**. The server validates the upload, stores the original privately, generates 1600 px and 320 px WebP derivatives, publishes them under content-addressed immutable keys, verifies their public bytes, records provenance in `config/admin/image-assets.json`, and creates a draft catalog substitution.

The draft still requires review and approval. Current catalog validation deliberately blocks licensed images until the release contract recognizes this registry, so an upload cannot silently enter production.

Set these local environment variables before launching the workbench:

```text
R2_ASSET_ACCOUNT_ID
R2_ASSET_ACCESS_KEY_ID
R2_ASSET_SECRET_ACCESS_KEY
R2_ASSET_ORIGINALS_BUCKET=cadence-assets-originals
R2_ASSET_PUBLIC_BUCKET=cadence-assets-public
R2_ASSET_PUBLIC_BASE_URL=https://assets.cadencetcg.dev
```

Use an R2 token scoped only to the two asset buckets. Never expose these server-side credentials in browser code, commit them, or add them to the catalog publication workflow.
