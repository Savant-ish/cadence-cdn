# Pokémon taxonomy administration

Set-era classification is Cadence-owned curated data. `tcgjson` names and dates are useful suggestions, but they are not authoritative era assignments.

Generate or refresh the review queue from a snapshot:

```sh
npm run taxonomy:suggest -- --snapshot snapshots/tcgjson/<release>/pokemon/catalog.json
npm run taxonomy:report -- --snapshot snapshots/tcgjson/<release>/pokemon/catalog.json
```

Suggestions use release-date boundaries and conservative name rules. They are written as `status: "pending"` and must be reviewed in `config/taxonomy/pokemon-sets.json`. To approve an assignment, confirm `eraId` and `kind`, then change its status to `approved`, source to `curated`, and add `reviewedBy` and an ISO `reviewedAt` timestamp. Existing approved assignments survive later suggestion refreshes.

Normal builds publish only approved assignments. `--require-approved-taxonomy` makes incomplete coverage a validation error; keep this off during initial curation and enable it for production once all existing sets have been reviewed. New upstream sets will then block publication until approved.

`taxonomy:report` returns total, approved, pending, missing, orphaned, and invalid counts. Treat `invalid` entries as configuration errors. `orphaned` assignments may represent removed or renamed upstream sets and should be investigated before deletion so identity history is not lost.

The live catalog currently permits missing classification. Consumers must not infer an era from release dates or treat pending suggestions as facts. Admin tooling should edit the curated configuration through reviewable commits and run the full verification suite before merge.
