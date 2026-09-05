# Sealed product boundary

Sealed products are a separate catalog domain, not cards, printings, sets, or image variants. The current publication contains card products only.

A future sealed importer should preserve provider rows that can be classified as sealed and normalize them into Cadence-owned product and configuration identities. It should model product family, included sets, language, edition, package configuration, release date, barcode or SKU crosswalks, and image provenance. Inventory will reference the sealed configuration ID, never a card printing ID.

Sealed artifacts should publish under a distinct per-game subtree and participate in the same validation, immutable build, checksum, and atomic pointer protocol. Adding that contract requires a schema-version review. Digital code products may be discarded, while sealed rows should be routed to the sealed importer once supported rather than mapped as cards.
