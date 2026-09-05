# Catalog schema 1.2.0

The machine-readable contract is [`schemas/catalog.schema.json`](../schemas/catalog.schema.json). Games contain sets and conceptual cards. Sets may carry a source icon URL under the same reference-only image policy used for card printings. A printing joins a card to a set and carries collector number, language, variant details, external cross-references, image-reference policy, and provenance.

An approved set taxonomy adds `classification.eraId`, `classification.eraName`, and `classification.kind`. Pending suggestions are never presented as approved catalog facts.

Cadence IDs are SHA-256-derived opaque identifiers. `identityKey` is intentionally retained for collision audits. Consumers must use `id`, not reconstruct it or depend on `identityKey` formatting.

Set identity uses the normalized game and full set name because upstream set abbreviations are not unique. Printing identity includes the conceptual card key as well as set, collector number (or an explicit unnumbered marker), language, and variant; this disambiguates products such as trainer-kit half decks that reuse collector numbers.

Collector-number punctuation is encoded by Unicode code point before slug normalization, so meaningful values such as `!/28` and `?/28` cannot collapse to the same identity.

Every list is sorted and every object key is serialized deterministically. Build time is derived from a pinned release unless explicitly supplied.

## Artifact tree

The publisher emits:

```text
manifest.json
import-report.json
games.json
games/pokemon/index.json
games/pokemon/sets.json
games/pokemon/cards.json
games/pokemon/printings.json
games/pokemon/sets/<cadence-set-id>.json
games/lorcana/index.json
games/lorcana/sets.json
games/lorcana/cards.json
games/lorcana/printings.json
games/lorcana/sets/<cadence-set-id>.json
```

The filename form of a set ID replaces `:` with `_`. Consumers should not derive this filename; use paths declared by `manifest.artifacts` or the game index.

`manifest.json` contains `schemaVersion`, `identityVersion`, `buildId`, `generatedAt`, provider metadata, supported games, aggregate counts, artifact descriptors, operational artifact descriptors, validation totals, and `imagePolicy`. Each consumer artifact descriptor provides `path`, `bytes`, `sha256`, and `records`. `import-report.json` is operational diagnostics and is checksum-bound through `operationalArtifacts`, but consumers do not need to ingest it.

The build ID covers the complete immutable publication descriptor: schema and identity versions, generation/provenance metadata, consumer artifacts, operational artifacts, validation summary, and image policy. A change to any published byte or its governing contract therefore produces a new immutable prefix.

## R2 pointer

The stable entry point is <https://cdn.cadencetcg.dev/catalog/latest.json>. It contains:

- `schemaVersion`
- `buildId`
- `generatedAt`
- `providerRelease`
- `manifestUrl`
- `catalogBaseUrl`

The pointer is mutable and briefly cached. Its target tree is immutable. Consumers must require matching schema/build values in the pointer and manifest, verify manifest-declared byte sizes and SHA-256 digests, and accept the complete build atomically. See [consumer integration](consumer-integration.md).

## Compatibility

Adding optional fields is backward-compatible within a schema line. Removing or changing field meaning, identity behavior, required fields, or artifact semantics requires a schema-version change. Consumers must explicitly allow supported schema versions rather than assuming every future version is compatible.
