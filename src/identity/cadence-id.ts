import { createHash } from 'node:crypto'
import { IDENTITY_VERSION } from '../domain/catalog.js'

export function normalizeComponent(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function normalizeCollectorNumber(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, '')
    .replace(
      /[^a-z0-9]/g,
      (character) => `-u${character.codePointAt(0)!.toString(16)}-`,
    )
}

export function identityKey(kind: string, ...components: string[]): string {
  const normalized = components.map(normalizeComponent)
  if (normalized.some((part) => part.length === 0))
    throw new Error(`Missing ${kind} identity component`)
  return [IDENTITY_VERSION, kind, ...normalized].join(':')
}

export function cadenceId(kind: string, key: string): string {
  const digest = createHash('sha256').update(key).digest('hex').slice(0, 24)
  return `cadence:${kind}:${IDENTITY_VERSION}:${digest}`
}

export function createIdentity(
  kind: string,
  ...components: string[]
): { id: string; identityKey: string } {
  const key = identityKey(kind, ...components)
  return { id: cadenceId(kind, key), identityKey: key }
}
