# Architecture

The pipeline has four boundaries: a provider resolves and fetches immutable source snapshots; an adapter maps provider fields to the Cadence domain; validation rejects unsafe catalogs; and the publisher emits provider-neutral artifacts. Only the adapter imports `tcgjson` types.

Raw downloads live under ignored `snapshots/`. `dist/` is generated and ignored. Publication should copy a completed `dist/` tree to versioned object storage only after validation succeeds.

Identity normalization is versioned as `v1`. Published identifiers must never be reinterpreted. A future normalization change requires a new version and an alias or migration map.
