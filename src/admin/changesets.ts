import { access } from 'node:fs/promises'
import type { NormalizedCatalog } from '../domain/catalog.js'
import { readJson } from '../util/json.js'

export type AdminEntityType = 'set' | 'card' | 'printing' | 'sealed-product'
type MatchOperator = 'equals' | 'contains' | 'missing'

export interface ChangeSetFile {
  schemaVersion: 1
  changeSets: CatalogChangeSet[]
}

export interface CatalogChangeSet {
  id: string
  title: string
  status: 'draft' | 'approved'
  reason: string
  createdBy: string
  createdAt: string
  approvedBy?: string
  approvedAt?: string
  operations: ChangeOperation[]
}

export interface ChangeOperation {
  entity: AdminEntityType
  select: {
    game?: string
    ids?: string[]
    where?: Array<{ field: string; operator: MatchOperator; value?: unknown }>
  }
  set?: Record<string, unknown>
  unset?: string[]
}

export interface ChangeSetReport {
  changeSets: number
  operations: number
  matches: number
  skippedDrafts: number
  details: Array<{
    changeSetId: string
    operation: number
    entity: AdminEntityType
    matches: number
  }>
}

const EDITABLE_FIELDS: Record<
  Exclude<AdminEntityType, 'sealed-product'>,
  Set<string>
> = {
  set: new Set([
    'name',
    'code',
    'releaseDate',
    'classification.eraId',
    'classification.eraName',
    'classification.kind',
    'image.sourceUrl',
    'image.status',
  ]),
  card: new Set(['name', 'cardType', 'metadata']),
  printing: new Set([
    'collectorNumber',
    'rarity',
    'language',
    'finish',
    'edition',
    'image.sourceUrl',
    'image.status',
  ]),
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${label} must be a non-empty string`)
  return value
}

export function validateChangeSetFile(value: unknown): ChangeSetFile {
  const root = object(value, 'Change-set file')
  if (root.schemaVersion !== 1)
    throw new Error('Change-set schemaVersion must be 1')
  if (!Array.isArray(root.changeSets))
    throw new Error('changeSets must be an array')
  const ids = new Set<string>()
  for (const [changeIndex, rawChangeSet] of root.changeSets.entries()) {
    const changeSet = object(rawChangeSet, `changeSets[${changeIndex}]`)
    const id = string(changeSet.id, `changeSets[${changeIndex}].id`)
    if (ids.has(id)) throw new Error(`Duplicate change-set id: ${id}`)
    ids.add(id)
    string(changeSet.title, `${id}.title`)
    string(changeSet.reason, `${id}.reason`)
    string(changeSet.createdBy, `${id}.createdBy`)
    string(changeSet.createdAt, `${id}.createdAt`)
    if (changeSet.status !== 'draft' && changeSet.status !== 'approved')
      throw new Error(`${id}.status must be draft or approved`)
    if (changeSet.status === 'approved') {
      string(changeSet.approvedBy, `${id}.approvedBy`)
      string(changeSet.approvedAt, `${id}.approvedAt`)
    }
    if (!Array.isArray(changeSet.operations) || !changeSet.operations.length)
      throw new Error(`${id}.operations must be a non-empty array`)
    for (const [
      operationIndex,
      rawOperation,
    ] of changeSet.operations.entries()) {
      const operation = object(
        rawOperation,
        `${id}.operations[${operationIndex}]`,
      )
      if (
        !['set', 'card', 'printing', 'sealed-product'].includes(
          String(operation.entity),
        )
      )
        throw new Error(
          `${id}.operations[${operationIndex}] has an unsupported entity`,
        )
      if (
        operation.entity === 'sealed-product' &&
        changeSet.status === 'approved'
      )
        throw new Error(
          `${id}: sealed-product operations cannot be approved before the sealed schema is available`,
        )
      const select = object(
        operation.select,
        `${id}.operations[${operationIndex}].select`,
      )
      if (select.game !== undefined)
        string(select.game, `${id}.operations[${operationIndex}].select.game`)
      const idsValue = select.ids
      if (
        idsValue !== undefined &&
        (!Array.isArray(idsValue) ||
          !idsValue.every((item) => typeof item === 'string'))
      )
        throw new Error(
          `${id}.operations[${operationIndex}].select.ids must contain strings`,
        )
      if (!select.game && (!Array.isArray(idsValue) || !idsValue.length))
        throw new Error(
          `${id}.operations[${operationIndex}] must select a game or explicit IDs`,
        )
      if (
        operation.unset !== undefined &&
        (!Array.isArray(operation.unset) ||
          !operation.unset.every((field) => typeof field === 'string'))
      )
        throw new Error(
          `${id}.operations[${operationIndex}].unset must contain strings`,
        )
      const fields = [
        ...Object.keys(operation.set ? object(operation.set, `${id}.set`) : {}),
        ...((operation.unset as unknown[] | undefined) ?? []).map((field) =>
          string(field, `${id}.unset`),
        ),
      ]
      if (!fields.length)
        throw new Error(`${id}.operations[${operationIndex}] makes no changes`)
      if (operation.entity !== 'sealed-product')
        for (const field of fields)
          if (
            !EDITABLE_FIELDS[
              operation.entity as keyof typeof EDITABLE_FIELDS
            ].has(field)
          )
            throw new Error(
              `${id}: ${operation.entity}.${field} is not editable`,
            )
      if (select.where !== undefined) {
        if (!Array.isArray(select.where))
          throw new Error(`${id}.select.where must be an array`)
        for (const rawMatch of select.where) {
          const match = object(rawMatch, `${id}.select.where[]`)
          string(match.field, `${id}.select.where[].field`)
          if (
            !['equals', 'contains', 'missing'].includes(String(match.operator))
          )
            throw new Error(`${id}.select.where has an unsupported operator`)
          if (match.operator !== 'missing' && !('value' in match))
            throw new Error(
              `${id}.select.where requires a value for ${String(match.operator)}`,
            )
        }
      }
    }
  }
  return value as ChangeSetFile
}

export async function loadChangeSets(
  path: string,
): Promise<ChangeSetFile | undefined> {
  try {
    await access(path)
  } catch {
    return undefined
  }
  return validateChangeSetFile(await readJson(path))
}

function get(record: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object'
          ? (value as Record<string, unknown>)[key]
          : undefined,
      record,
    )
}

function assign(
  record: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const keys = path.split('.')
  let target = record
  for (const key of keys.slice(0, -1)) {
    const current = target[key]
    if (!current || typeof current !== 'object' || Array.isArray(current))
      target[key] = {}
    target = target[key] as Record<string, unknown>
  }
  const final = keys.at(-1)!
  if (value === undefined) delete target[final]
  else target[final] = value
}

export function applyChangeSets(
  catalog: NormalizedCatalog,
  file: ChangeSetFile | undefined,
  includeDrafts = false,
): ChangeSetReport {
  const report: ChangeSetReport = {
    changeSets: 0,
    operations: 0,
    matches: 0,
    skippedDrafts: 0,
    details: [],
  }
  if (!file) return report
  const gameById = new Map(catalog.games.map((game) => [game.id, game.slug]))
  const setById = new Map(catalog.sets.map((set) => [set.id, set]))
  for (const changeSet of file.changeSets) {
    if (changeSet.status === 'draft' && !includeDrafts) {
      report.skippedDrafts += 1
      continue
    }
    report.changeSets += 1
    for (const [index, operation] of changeSet.operations.entries()) {
      if (operation.entity === 'sealed-product') {
        report.operations += 1
        report.details.push({
          changeSetId: changeSet.id,
          operation: index,
          entity: operation.entity,
          matches: 0,
        })
        continue
      }
      const records =
        operation.entity === 'set'
          ? catalog.sets
          : operation.entity === 'card'
            ? catalog.cards
            : catalog.printings
      const selected = records.filter((record) => {
        if (
          operation.select.ids?.length &&
          !operation.select.ids.includes(record.id)
        )
          return false
        if (operation.select.game) {
          const gameId =
            'gameId' in record
              ? record.gameId
              : setById.get(record.setId)?.gameId
          if (!gameId || gameById.get(gameId) !== operation.select.game)
            return false
        }
        return (operation.select.where ?? []).every((match) => {
          const value = get(
            record as unknown as Record<string, unknown>,
            match.field,
          )
          if (match.operator === 'missing')
            return value === undefined || value === null || value === ''
          if (match.operator === 'equals') return value === match.value
          return String(value ?? '')
            .toLowerCase()
            .includes(String(match.value ?? '').toLowerCase())
        })
      })
      for (const record of selected) {
        for (const [field, value] of Object.entries(operation.set ?? {}))
          assign(record as unknown as Record<string, unknown>, field, value)
        for (const field of operation.unset ?? [])
          assign(record as unknown as Record<string, unknown>, field, undefined)
      }
      report.operations += 1
      report.matches += selected.length
      report.details.push({
        changeSetId: changeSet.id,
        operation: index,
        entity: operation.entity,
        matches: selected.length,
      })
    }
  }
  return report
}
