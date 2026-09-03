# Cadence CDN: Catalog Pipeline Handoff

## Objective

Build `cadence-cdn` as a provider-neutral catalog ingestion and publishing repository for Cadence. Its first adapter should ingest the weekly `tcgjson` bulk catalog, normalize Pokemon first, validate the result, and emit stable catalog assets that `cadence-web` can consume.

This repository owns catalog acquisition and normalization. `cadence-web` should consume only the published Cadence schema and must not depend on `tcgjson`, TCGplayer, or another provider's response shape.

## Initial scope

The first milestone should:

1. Fetch the latest `bulk-data.json` manifest from the `tcgjson` GitHub release.
2. Select and download the Pokemon compact or full catalog.
3. Verify the downloaded artifact using manifest metadata/checksums when provided.
4. Store source provenance for every imported record.
5. Normalize games, sets, cards, and printings into a Cadence-owned schema.
6. Generate stable Cadence identifiers that do not depend on TCGplayer product IDs.
7. Validate uniqueness, required fields, referential integrity, and deterministic output.
8. Publish JSON artifacts and a Cadence manifest for downstream consumers.
9. Use source image URLs as metadata only. Do not download, commit, or republish card images yet.

Pricing, seller inventory, marketplace listings, and sealed-product ingestion are outside the first milestone.

## Source

- Repository: <https://github.com/HanClinto/tcgjson>
- Releases: <https://github.com/HanClinto/tcgjson/releases/latest>
- Documentation: <https://hanclinto.github.io/tcgjson/>
- Manifest URL: `https://github.com/HanClinto/tcgjson/releases/latest/download/bulk-data.json`

At the time of evaluation, `tcgjson` publishes weekly bulk catalogs for Magic: The Gathering, Pokemon, Yu-Gi-Oh!, Digimon, One Piece, Disney Lorcana, Star Wars: Unlimited, Union Arena, and Riftbound. It publishes singles data, not sealed products. Images are represented by TCGplayer CDN URLs; image files are not included.

## Licensing and source policy

The `tcgjson` repository is MIT licensed, but its catalog is derived from TCGplayer public endpoints and card artwork remains owned by publishers or other rights holders. An open-source license on importer software does not necessarily grant commercial redistribution rights to upstream catalog records or artwork.

For the initial implementation:

- Treat `tcgjson` as an ingestion and cross-reference source.
- Retain source name, source release, external product ID, source URL, and import time.
- Do not imply that a TCGplayer product ID is a Cadence-owned identifier.
- Do not mirror TCGplayer card images into the public Cadence CDN until usage rights are confirmed.
- Keep image acquisition behind a separate, disabled pipeline stage.
- Make every provider replaceable without changing the public Cadence schema.
- Document future provider licenses and retention requirements in `docs/source-policies/`.

This is an engineering policy, not a legal conclusion. Production image and dataset redistribution should receive explicit written authorization or legal review.

## Suggested repository structure

```text
cadence-cdn/
  README.md
  package.json
  tsconfig.json
  docs/
    architecture.md
    catalog-schema.md
    source-policies/
      tcgjson.md
  src/
    cli.ts
    domain/
      catalog.ts
    providers/
      provider.ts
      tcgjson/
        client.ts
        mapper.ts
        types.ts
    pipeline/
      ingest.ts
      normalize.ts
      publish.ts
      validate.ts
    identity/
      cadence-id.ts
  fixtures/
    tcgjson/
      pokemon.sample.json
  tests/
  snapshots/             # ignored; raw provider downloads
  dist/                  # ignored or release-managed generated output
```

Avoid placing raw snapshots and large generated catalogs in Git. Commit small deterministic fixtures, schemas, importer code, validation logic, documentation, and optionally small manifests. Publish large artifacts through object storage or release assets.

## Provider boundary

Define a narrow interface so `tcgjson` is only the first implementation:

```ts
export interface CatalogProvider {
  readonly name: string
  resolveRelease(): Promise<SourceRelease>
  fetchGame(release: SourceRelease, game: string): Promise<unknown>
  normalize(input: unknown, context: ImportContext): Promise<NormalizedCatalog>
}
```

Provider-specific fields should stop at the adapter boundary. The publisher should receive only normalized Cadence records.

## Recommended domain model

Keep the distinction between a conceptual card and a specific printing. Inventory ultimately attaches to a printing/SKU-like record, not merely a card name.

```ts
export interface CatalogGame {
  id: string
  slug: string
  name: string
}

export interface CatalogSet {
  id: string
  gameId: string
  code?: string
  name: string
  releaseDate?: string
}

export interface CatalogCard {
  id: string
  gameId: string
  name: string
  normalizedName: string
  cardType?: string
  metadata?: Record<string, unknown>
}

export interface CatalogPrinting {
  id: string
  cardId: string
  setId: string
  collectorNumber?: string
  rarity?: string
  language: string
  finish?: string
  edition?: string
  image?: {
    sourceUrl?: string
    status: 'reference-only' | 'licensed' | 'unavailable'
  }
  externalIds: Record<string, string>
  provenance: CatalogProvenance
}

export interface CatalogProvenance {
  provider: string
  release: string
  sourceUrl?: string
  importedAt: string
}
```

Do not force every game's unique rules fields into top-level columns. Promote fields used across catalog identity and inventory; retain game-specific properties under validated metadata.

## Stable identity

Cadence IDs must survive a provider replacement. Do not use `tcgjson` or TCGplayer product IDs as primary keys.

Use deterministic IDs based on normalized identity components and a versioned namespace. Conceptually:

```text
game:      cadence:game:{game-slug}
set:       cadence:set:{game-slug}:{normalized-set-code-or-name}
card:      cadence:card:{game-slug}:{canonical-card-key}
printing:  cadence:printing:{game-slug}:{set-key}:{collector-number}:{language}:{variant}
```

Hashing these keys is acceptable, but retain the unhashed identity key for debugging and collision audits. Identity normalization rules must be explicit and versioned. Never silently change them after publishing IDs; introduce aliases or a migration map instead.

## Output contract

A first release can emit:

```text
dist/
  manifest.json
  games.json
  games/
    pokemon/
      index.json
      sets.json
      cards.json
      printings.json
      sets/
        {set-id}.json
```

The manifest should include:

- Cadence schema version
- build identifier and timestamp
- provider release identifier
- supported games
- artifact paths, byte sizes, record counts, and checksums
- validation result
- image-policy status

Generate output deterministically: stable sorting, consistent JSON formatting, no volatile timestamps inside individual records, and repeatable IDs. Keep build time in the manifest rather than allowing it to change every record.

## Validation requirements

Fail the build when:

- A required identity component is missing.
- Cadence IDs collide.
- External IDs unexpectedly map to multiple printings.
- A printing references a missing game, set, or card.
- Duplicate printings share the same normalized identity.
- Record counts fall sharply relative to the previous accepted snapshot without an explicit override.
- An image is marked licensed without an approved source policy.
- Generated output differs between identical runs over the same snapshot.

Warn, but do not necessarily fail, for missing rarity, release date, optional metadata, or source image URL.

## First implementation sequence

### Phase 1: Foundation

- Initialize TypeScript, formatting, linting, and tests.
- Define normalized domain types and JSON schemas.
- Implement deterministic ID generation and tests.
- Add the source-policy documentation.

### Phase 2: Pokemon proof of concept

- Download the release manifest and Pokemon artifact.
- Save raw downloads under ignored `snapshots/tcgjson/{release}/`.
- Map a small committed fixture first.
- Normalize the complete Pokemon dataset.
- Emit and validate deterministic artifacts.
- Compare representative records against the source.

### Phase 3: Pipeline hardening

- Add checksum verification, retries, timeouts, and clear failures.
- Add count-regression and schema-drift reporting.
- Generate a machine-readable import report.
- Add a dry-run mode that performs no publication.

### Phase 4: Additional games

- Add games one at a time through configuration plus explicit mapping tests.
- Prefer dedicated authoritative/open datasets when they are materially better.
- Maintain external-ID crosswalks when two sources describe the same printing.

### Phase 5: Sealed products and images

- Design sealed SKUs separately from singles because `tcgjson` does not supply them.
- Model package conversions such as case to box, box to inner, and box to pack.
- Activate image mirroring only for approved sources, with license provenance per asset.

## Cadence-web integration

`cadence-web` should fetch versioned Cadence artifacts through a small catalog client. It should not:

- Fetch `tcgjson` directly.
- Construct TCGplayer image URLs.
- Use a TCGplayer product ID as its database primary key.
- Interpret provider-specific custom attributes.

The web application may retain external identifiers for linking and reconciliation, but inventory records should reference a Cadence printing ID. This allows liquidity-market inventory moving in or out of vendor inventory to resolve to the same catalog identity.

## Definition of done for the first milestone

- One command imports a pinned `tcgjson` release or resolves the latest release explicitly.
- Pokemon sets, cards, and printings are normalized successfully.
- Every published record has a stable Cadence ID and source provenance.
- Re-running against the same snapshot produces byte-identical catalog artifacts.
- Validation and unit tests pass.
- Raw provider snapshots and card images are not committed.
- No images are mirrored or presented as licensed.
- The output manifest is sufficient for `cadence-web` to locate and verify artifacts.
- The README explains local use, updating, validation, publication, and source restrictions.

## Suggested first command surface

```text
npm run catalog:fetch -- --provider tcgjson --game pokemon --release latest
npm run catalog:build -- --provider tcgjson --game pokemon
npm run catalog:validate
npm test
```

Resolve `latest` to a concrete release before the build begins and record that version. Production builds should support pinning the release for reproducibility.

## Handoff prompt for the first coding session

> Initialize this repository as a provider-neutral TypeScript catalog pipeline. Implement the normalized schema, deterministic Cadence IDs, a `tcgjson` provider adapter, fixture-based tests, and Pokemon ingestion. Retain full provenance and external IDs. Generate deterministic versioned JSON and a checksummed manifest. Do not download or republish card images, and keep raw snapshots and generated large files out of Git.
