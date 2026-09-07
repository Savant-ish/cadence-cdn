# Catalog bulk administration

Catalog administration follows the same model as a metadata tag editor: filter records, select many rows, apply field changes, preview the result, and submit the resulting change set for review.

Provider snapshots remain immutable. Approved changes in `config/admin/change-sets.json` are applied after provider normalization and curated taxonomy, then pass through normal catalog validation. The checksum-bound `import-report.json` records the number of change sets, operations, and matched records, so a release cannot conceal override activity.

## Change-set workflow

1. Create a uniquely named draft with an author, timestamp, and reason.
2. Add bulk operations targeting `set`, `card`, or `printing` records.
3. Select explicit Cadence IDs, a game slug, or a game plus field predicates.
4. Run `npm run admin:validate` to validate structure and protected fields.
5. Run `npm run admin:preview -- --games pokemon,lorcana,onepiece --snapshot-root snapshots/tcgjson/current` to apply drafts in memory and report match counts.
6. Review the preview, set the change set to `approved`, and record the reviewer.
7. Run the complete verification suite. Normal builds apply approved change sets and skip drafts.

Example:

```json
{
  "id": "lorcana-chapter-era",
  "title": "Classify reviewed Lorcana sets",
  "status": "draft",
  "reason": "Bulk review in catalog admin",
  "createdBy": "admin@example.com",
  "createdAt": "2026-09-05T15:00:00Z",
  "operations": [
    {
      "entity": "set",
      "select": {
        "game": "lorcana",
        "where": [{ "field": "code", "operator": "contains", "value": "1" }]
      },
      "set": {
        "classification.eraId": "chapter-sets",
        "classification.eraName": "Chapter Sets",
        "classification.kind": "expansion"
      }
    }
  ]
}
```

Selectors support `equals`, case-insensitive `contains`, and `missing`. Operations may also provide an `unset` array. At least a game or explicit ID list is required, preventing an accidental unscoped edit across the whole catalog.

Identity, ownership, relationships, external IDs, and provenance are protected. Editable fields cover display metadata, classification, language and variant descriptions, and reference-image state. Validation continues to reject unsupported licensed-image claims.

`sealed-product` is reserved as an entity type so the eventual TCGCSV candidate-review UI and saved drafts have a stable vocabulary. Such operations may remain drafts, but approval is rejected until the sealed product/configuration schema and validator exist. The review UI must show classifier confidence and evidence rather than treating every non-card product as sealed.

## Web editor contract

The cadence-web admin interface should treat change sets as its save format. Its grid can provide keyboard editing, multi-select, fill, find/replace, saved filters, image review, undo/redo, and a diff pane, but it should not update catalog database rows or R2 objects directly. Approval should produce a reviewable change to this repository; the deterministic publication workflow remains the only production write path.

## Local Codex workbench

Fetch the current snapshots for every registered game, then start the local tool:

```sh
npm run catalog:fetch -- --game pokemon --output snapshots/tcgjson/current/pokemon
npm run catalog:fetch -- --game lorcana --output snapshots/tcgjson/current/lorcana
npm run catalog:fetch -- --game onepiece --output snapshots/tcgjson/current/onepiece
npm run admin:serve
```

Open the tokenized `127.0.0.1` URL printed by the process. The token changes on every launch and is required by all local API calls. `CADENCE_ADMIN_PORT` changes the default port `4317`; `CADENCE_SNAPSHOT_ROOT` selects another snapshot root.

The interface supports game/entity selection, text filtering, up to 500 visible records, row selection, manual bulk field edits, a natural-language instruction, schema-constrained Codex proposals, deterministic before/after previews, and saving a proposal as a draft. AI requests are limited to 200 explicitly selected records.

Set and card-printing rows display image thumbnails and visibly mark failed image loads. Choose `image.sourceUrl` in the manual editor to compare the first selected record's current image with a proposed HTTP(S) replacement before previewing the change. Conceptual cards do not own artwork; select `Card printings` when reviewing card images.

The owned-image panel accepts a legally sourced local file plus provenance and reviewer metadata, stores the immutable original privately, generates display and thumbnail WebP derivatives, uploads and publicly verifies them, records `config/admin/image-assets.json`, and returns a draft `licensed` substitution. Catalog validation still blocks that draft from production until registry-aware licensed-image validation and the corresponding manifest contract are implemented.

The server invokes `codex exec` ephemerally with a read-only sandbox, passes the bounded selection through standard input, and requires output matching `schemas/admin-proposal.schema.json`. It then forces `status: draft`, removes approval fields, validates editable fields, and previews the operation. Saving only appends the validated draft to the local change-set file. A human must review the Git diff and add approval metadata separately.

The workbench binds only to `127.0.0.1`; do not proxy or deploy it. It relies on the locally installed and authenticated Codex CLI. The browser receives no OpenAI API key or production credential.
