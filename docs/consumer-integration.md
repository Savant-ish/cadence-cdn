# Catalog consumer integration

The stable bootstrap URL is:

```text
https://cdn.cadencetcg.dev/catalog/latest.json
```

Consumers must not hard-code a build ID or derive artifact paths from provider conventions.

## Acceptance protocol

1. Fetch `latest.json` and validate its required fields.
2. Reject unsupported `schemaVersion` values before downloading a build.
3. If `buildId` is already accepted locally, stop; the catalog is unchanged.
4. Fetch `manifestUrl` and require its `buildId` and `schemaVersion` to match the pointer.
5. Resolve each manifest artifact path against `catalogBaseUrl`.
6. Verify the exact byte length and SHA-256 digest before parsing each artifact.
7. Validate required record fields and internal references.
8. Commit the complete build atomically and retain the previous accepted build for rollback.

A partial download, malformed JSON, checksum mismatch, unsupported schema, or failed reference validation must leave the previously accepted build active. The mutable pointer is cached briefly; build artifacts are immutable and may be cached indefinitely by build ID.

## Identity rules

- Inventory and marketplace records should reference Cadence printing IDs.
- A conceptual card ID is not a printing or SKU identity.
- Provider IDs may be retained only for reconciliation and outbound links.
- Treat `identityKey` as diagnostic data. Do not parse it or recreate IDs.
- Code must remain game-neutral and use `supportedGames` plus `games.json` for discovery.

Sealed inventory must not reference card-printing IDs. A later sealed catalog will define its own product and configuration identities without changing the card identity contract.

## Image and taxonomy behavior

An image with `status: "reference-only"` is an external hint, not a Cadence-owned asset or availability guarantee. Use a safe fallback for missing or broken URLs and never display it as licensed. Future owned substitutions will be expressed through a Cadence-controlled asset contract rather than by changing provider IDs.

`classification` is optional while taxonomy review is incomplete. Consumers must gracefully handle sets without era or set-kind classification.

## Cross-origin access

The public catalog permits browser `GET` and `HEAD` requests. No API key, R2 credential, or application secret belongs in a browser client.
