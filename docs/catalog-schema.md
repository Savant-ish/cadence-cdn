# Catalog schema 1.0.0

The machine-readable contract is [`schemas/catalog.schema.json`](../schemas/catalog.schema.json). Games contain sets and conceptual cards. A printing joins a card to a set and carries collector number, language, variant details, external cross-references, image-reference policy, and provenance.

Cadence IDs are SHA-256-derived opaque identifiers. `identityKey` is intentionally retained for collision audits. Consumers must use `id`, not reconstruct it or depend on `identityKey` formatting.

Set identity uses the normalized game and full set name because upstream set abbreviations are not unique. Printing identity includes the conceptual card key as well as set, collector number (or an explicit unnumbered marker), language, and variant; this disambiguates products such as trainer-kit half decks that reuse collector numbers.

Collector-number punctuation is encoded by Unicode code point before slug normalization, so meaningful values such as `!/28` and `?/28` cannot collapse to the same identity.

Every list is sorted and every object key is serialized deterministically. Build time is derived from a pinned release unless explicitly supplied.
