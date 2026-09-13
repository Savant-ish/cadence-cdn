# Sealed product catalog plan

Sealed products are a separate catalog domain, not cards, printings, sets, or image variants. The current publication contains card products only. Sealed identity and metadata belong in `cadence-cdn`; changing sealed prices belong in `cadence-pricing`.

## Initial source

TCGCSV is the planned initial discovery source. Its TCGplayer category/group product collections contain both individual cards and sealed boxes, packs, decks, tins, bundles, and other merchandise. Fetch product metadata as a pinned raw snapshot and retain TCGplayer `productId` as an external crosswalk.

TCGCSV does not provide a guaranteed normalized card/sealed discriminator or SKU collection. Classification must therefore be conservative:

```text
TCGCSV product
  -> known card printing
  -> confidently sealed candidate
  -> digital code product
  -> unsupported merchandise
  -> uncertain admin-review queue
```

A failed card match is not evidence that a product is sealed. Classification may use structured extended data, presence or absence of card number/rarity/text, UPC, product and group names, per-game packaging terminology, and reviewed overrides. Digital code products are discarded. Ambiguous decks, lots, accessories, and configurations remain pending.

## Domain model

`SealedProduct` represents the durable commercial product family:

```text
id, identityKey, gameId, name, productFamily,
includedSetIds[], releaseDate, externalIds, image, provenance
```

`SealedConfiguration` represents the exact inventory identity:

```text
id, identityKey, productId, configurationType,
language, edition, unitsPerPackage, barcode, externalIds
```

Initial product families should include booster pack, sleeved booster, booster box/display, case, starter deck, collection box, tin, blister, prerelease/build-and-battle kit, bundle/trove/ETB, and special collection. Provider terminology must map through per-game rules rather than becoming the public vocabulary.

Inventory references a sealed configuration ID, never a card printing ID. Cases and multipacks may require curated containment relationships where provider metadata is incomplete.

## Publication and administration

Until product metadata is pinned and classified, cadence-pricing retains full
unresolved TCGCSV price observations separately. This preserves potential
sealed market data without allowing an unmatched product to become a sealed
catalog record or a card valuation.

Sealed artifacts should publish under distinct per-game paths and participate in catalog validation, deterministic build identity, checksums, GitHub release archival, and atomic R2 publication. Adding the public contract requires a schema-version review and cadence-web coordination.

The admin workbench should expose sealed candidates, confidence/reasons, uncertain classifications, duplicate crosswalks, product family, included sets, configuration, UPC, and reference image. Only reviewed classifications enter production. TCGCSV product-level pricing may help `cadence-pricing`, but price fields must not be embedded in sealed catalog records.
