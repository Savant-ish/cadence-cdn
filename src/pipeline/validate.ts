import { readFile } from 'node:fs/promises'
import type {
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

export function validateCatalog(catalog: NormalizedCatalog): ValidationReport {
  const issues: ValidationIssue[] = []
  const gameIds = new Set(catalog.games.map((item) => item.id))
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
  for (const set of catalog.sets)
    if (!gameIds.has(set.gameId))
      issues.push({
        severity: 'error',
        code: 'missing-game',
        message: `${set.id} references ${set.gameId}`,
      })
  for (const card of catalog.cards)
    if (!gameIds.has(card.gameId))
      issues.push({
        severity: 'error',
        code: 'missing-game',
        message: `${card.id} references ${card.gameId}`,
      })
  const externalIds = new Map<string, string>()
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
  }
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
