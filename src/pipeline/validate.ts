import { readFile } from 'node:fs/promises'
import type {
  CatalogPrinting,
  NormalizedCatalog,
  ValidationIssue,
  ValidationReport,
} from '../domain/catalog.js'

function duplicateIssues(values: string[], label: string): ValidationIssue[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const value of values) (seen.has(value) ? duplicates : seen).add(value)
  return [...duplicates].map((value) => ({
    severity: 'error',
    code: `duplicate-${label}`,
    message: `${label} is duplicated: ${value}`,
  }))
}

function normalizedIdentityKey(input: string | undefined): string {
  return input?.trim() ? input.trim() : '(unknown)'
}

function physicalIdentityKey(item: CatalogPrinting): string {
  return [
    item.cardId,
    item.setId,
    item.language,
    normalizedIdentityKey(item.edition),
    normalizedIdentityKey(item.finish),
  ].join('|')
}

function hasCompoundFinish(value: string | undefined): boolean {
  return typeof value === 'string' && /[,/;]/.test(value)
}

function hasEmbeddedEdition(value: string | undefined): boolean {
  return (
    typeof value === 'string' &&
    /\b(?:\d+(?:st|nd|rd|th)?\s+edition|first\s+edition|unlimited)\b/i.test(
      value,
    )
  )
}

function mapCounts(values: Map<string, number>): Record<string, number> {
  return Object.fromEntries(
    [...values.entries()].sort((a, b) => a[0].localeCompare(b[0])),
  )
}

export function validateCatalog(catalog: NormalizedCatalog): ValidationReport {
  const issues: ValidationIssue[] = []
  const gameIds = new Set(catalog.games.map((item) => item.id))
  const pokemonGameIds = new Set(
    catalog.games
      .filter((item) => item.slug === 'pokemon')
      .map((item) => item.id),
  )
  const setIds = new Set(catalog.sets.map((item) => item.id))
  const cardIds = new Set(catalog.cards.map((item) => item.id))
  issues.push(
    ...duplicateIssues(
      [
        ...catalog.games,
        ...catalog.sets,
        ...catalog.cards,
        ...catalog.printings,
      ].map((item) => item.id),
      'cadence-id',
    ),
    ...duplicateIssues(
      catalog.printings.map((item) => item.identityKey),
      'printing-identity',
    ),
  )
  for (const set of catalog.sets) {
    if (!gameIds.has(set.gameId))
      issues.push({
        severity: 'error',
        code: 'missing-game',
        message: `${set.id} references ${set.gameId}`,
      })
    if (!set.image?.sourceUrl)
      issues.push({
        severity: 'warning',
        code: 'missing-set-image-reference',
        message: `${set.id} lacks a source set image URL`,
      })
    if (set.image?.status === 'licensed')
      issues.push({
        severity: 'error',
        code: 'unapproved-set-image-license',
        message: `${set.id} marks a set image licensed without an approved source policy`,
      })
    if (pokemonGameIds.has(set.gameId) && !set.classification)
      issues.push({
        severity: 'warning',
        code: 'unclassified-set',
        message: `${set.id} lacks an approved era and set-kind classification`,
      })
  }
  for (const card of catalog.cards)
    if (!gameIds.has(card.gameId))
      issues.push({
        severity: 'error',
        code: 'missing-game',
        message: `${card.id} references ${card.gameId}`,
      })
  const externalIds = new Map<string, string>()
  const languageCounts = new Map<string, number>()
  const editionCounts = new Map<string, number>()
  const finishCounts = new Map<string, number>()
  const physicalIdentities = new Map<string, number>()
  let compoundFinishCount = 0
  let embeddedEditionInFinishCount = 0
  for (const printing of catalog.printings) {
    if (!cardIds.has(printing.cardId))
      issues.push({
        severity: 'error',
        code: 'missing-card',
        message: `${printing.id} references ${printing.cardId}`,
      })
    if (!setIds.has(printing.setId))
      issues.push({
        severity: 'error',
        code: 'missing-set',
        message: `${printing.id} references ${printing.setId}`,
      })
    if (!printing.collectorNumber)
      issues.push({
        severity: 'warning',
        code: 'missing-collector-number',
        message: `${printing.id} uses its normalized name as the unnumbered identity component`,
      })
    if (!printing.rarity)
      issues.push({
        severity: 'warning',
        code: 'missing-rarity',
        message: `${printing.id} lacks rarity`,
      })
    if (!printing.image?.sourceUrl)
      issues.push({
        severity: 'warning',
        code: 'missing-image-reference',
        message: `${printing.id} lacks a source image URL`,
      })
    if (printing.image?.status === 'licensed')
      issues.push({
        severity: 'error',
        code: 'unapproved-image-license',
        message: `${printing.id} marks an image licensed without an approved source policy`,
      })
    for (const [provider, externalId] of Object.entries(printing.externalIds)) {
      const key = `${provider}:${externalId}`
      const existing = externalIds.get(key)
      if (existing && existing !== printing.id)
        issues.push({
          severity: 'error',
          code: 'ambiguous-external-id',
          message: `${key} maps to ${existing} and ${printing.id}`,
        })
      externalIds.set(key, printing.id)
    }
    languageCounts.set(
      printing.language,
      (languageCounts.get(printing.language) ?? 0) + 1,
    )
    const edition = normalizedIdentityKey(printing.edition)
    editionCounts.set(edition, (editionCounts.get(edition) ?? 0) + 1)
    const finish = normalizedIdentityKey(printing.finish)
    finishCounts.set(finish, (finishCounts.get(finish) ?? 0) + 1)
    if (hasCompoundFinish(printing.finish)) compoundFinishCount += 1
    if (hasEmbeddedEdition(printing.finish)) embeddedEditionInFinishCount += 1
    const physicalIdentity = physicalIdentityKey(printing)
    physicalIdentities.set(
      physicalIdentity,
      (physicalIdentities.get(physicalIdentity) ?? 0) + 1,
    )
  }
  const duplicatePhysicalIdentityCount = [
    ...physicalIdentities.values(),
  ].filter((item) => item > 1).length
  if (duplicatePhysicalIdentityCount > 0)
    issues.push({
      severity: 'warning',
      code: 'duplicate-physical-identity',
      message: `${duplicatePhysicalIdentityCount} canonical printing identities are duplicated`,
    })
  const counts = {
    games: catalog.games.length,
    sets: catalog.sets.length,
    cards: catalog.cards.length,
    printings: catalog.printings.length,
  }
  return {
    valid: !issues.some((item) => item.severity === 'error'),
    counts,
    issues,
    identityAudit: {
      printingsByLanguage: mapCounts(languageCounts),
      printingsByEdition: mapCounts(editionCounts),
      printingsByFinish: mapCounts(finishCounts),
      compoundFinishCount,
      editionEmbeddedInFinishCount: embeddedEditionInFinishCount,
      duplicatePhysicalIdentityCount,
    },
  }
}

export async function checkCountRegression(
  report: ValidationReport,
  previousManifestPath: string | undefined,
  allowedDropPercent = 10,
): Promise<void> {
  if (!previousManifestPath) return
  const previous = JSON.parse(await readFile(previousManifestPath, 'utf8')) as {
    counts?: Record<string, number>
  }
  for (const key of ['sets', 'cards', 'printings'] as const) {
    const oldCount = previous.counts?.[key]
    if (
      oldCount &&
      report.counts[key] < oldCount * (1 - allowedDropPercent / 100)
    ) {
      report.issues.push({
        severity: 'error',
        code: 'count-regression',
        message: `${key} fell from ${oldCount} to ${report.counts[key]} (> ${allowedDropPercent}%)`,
      })
      report.valid = false
    }
  }
}

export function assertValid(report: ValidationReport): void {
  if (!report.valid)
    throw new Error(
      `Catalog validation failed:\n${report.issues
        .filter((item) => item.severity === 'error')
        .map((item) => `- [${item.code}] ${item.message}`)
        .join('\n')}`,
    )
}
