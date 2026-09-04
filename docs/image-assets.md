# Image asset lifecycle

## Current behavior

`tcgjson` supplies TCGplayer-hosted card and set image URLs. The mapper retains these only as `sourceUrl` metadata with `status: "reference-only"`; the pipeline does not fetch, copy, optimize, or publish those files. URLs may be missing, incorrect, low quality, or removed upstream.

The validator rejects a `licensed` status until an approved source policy exists. This is an engineering safeguard, not a legal determination.

## Storage boundaries

- `cadence-assets-originals` is private storage for future legally sourced original captures.
- `cadence-assets-public` is reserved for approved web derivatives.
- Catalog JSON remains in `cadence-catalog-public` and should reference only approved public asset records when substitution is implemented.

No public endpoint is enabled for either asset bucket today. The originals bucket must never receive a public custom domain or `r2.dev` access.

## Required future promotion workflow

An owned image must not become public merely because a file was uploaded. Admin tooling should record the game, entity type and Cadence ID, source/creator, capture date, rights basis, original digest, reviewer, approval time, derivative recipe, derivative digest, and superseded asset when applicable.

The intended lifecycle is:

```text
legally sourced capture
  -> private immutable original
  -> metadata and rights review
  -> deterministic web derivatives
  -> approval
  -> public asset publication
  -> atomic catalog substitution
```

Substitutions should preserve history and support rollback. Public keys should be content-addressed or versioned and cacheable as immutable. Catalog records should distinguish the active Cadence-owned asset from a provider reference; provider URLs remain useful for reconciliation but are not the fallback authority.

Use separate, bucket-scoped credentials for capture, review/promotion, and catalog publication. Multi-TCG support belongs in asset metadata and key structure rather than separate ad hoc pipelines per game.
