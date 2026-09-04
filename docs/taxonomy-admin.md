# Pokémon taxonomy administration

Set-era classification is Cadence-owned curated data. `tcgjson` names and dates are useful suggestions, but they are not authoritative era assignments.

Generate or refresh the review queue from a snapshot:

```sh
npm run taxonomy:suggest -- --snapshot snapshots/tcgjson/<release>/pokemon/catalog.json
npm run taxonomy:report -- --snapshot snapshots/tcgjson/<release>/pokemon/catalog.json
```

Suggestions use release-date boundaries and conservative name rules. They are written as `status: "pending"` and must be reviewed in `config/taxonomy/pokemon-sets.json`. To approve an assignment, confirm `eraId` and `kind`, then change its status to `approved`, source to `curated`, and add `reviewedBy` and an ISO `reviewedAt` timestamp. Existing approved assignments survive later suggestion refreshes.

Normal builds publish only approved assignments. `--require-approved-taxonomy` makes incomplete coverage a validation error; keep this off during initial curation and enable it for production once all existing sets have been reviewed. New upstream sets will then block publication until approved.
