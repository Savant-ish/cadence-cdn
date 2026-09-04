# tcgjson source policy

- Provider: `tcgjson` (<https://github.com/HanClinto/tcgjson>)
- Importer license: MIT
- Upstream basis: TCGplayer public catalog/search endpoints
- Retention: keep release ID, source URL when present, TCGplayer product ID as an external ID, and deterministic import time
- Card and set images: URL metadata only, always `reference-only` or `unavailable`
- Redistribution: dataset and artwork rights require separate review; this repository makes no grant or legal conclusion

The provider-image acquisition pipeline is absent and therefore disabled. The presence of public and private R2 asset buckets does not authorize mirroring: no provider card or set images may be downloaded or published by this MVP. Future legally sourced originals follow [the owned image lifecycle](../image-assets.md) and require a separate approved source policy before any record can use `licensed` status.
