import { access, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { writeJson } from '../util/json.js'
import type { ProviderPriceFeed, ProviderPriceObservation } from './domain.js'

interface TcgcsvGroup {
  groupId: number
  name?: string
}

interface TcgcsvPrice {
  productId: number
  subTypeName?: string
  lowPrice?: number | null
  midPrice?: number | null
  highPrice?: number | null
  marketPrice?: number | null
}

interface TcgcsvResponse<T> {
  success: boolean
  errors?: unknown[]
  results: T[]
}

export interface TcgcsvFetchOptions {
  categoryId: number
  output: string
  baseUrl?: string
  userAgent?: string
  minimumDelayMs?: number
}

interface FetchDependencies {
  fetch?: typeof fetch
  delay?: (milliseconds: number) => Promise<void>
}

function endpoint(base: string, path: string): string {
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

function responseResults<T>(value: unknown, label: string): T[] {
  if (!value || typeof value !== 'object')
    throw new Error(`${label} returned invalid JSON`)
  const response = value as TcgcsvResponse<T>
  if (response.success !== true || !Array.isArray(response.results))
    throw new Error(`${label} failed: ${JSON.stringify(response.errors ?? [])}`)
  return response.results
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function minor(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`TCGCSV returned an invalid price: ${String(value)}`)
  return Math.round((value + Number.EPSILON) * 100)
}

export async function fetchTcgcsvPricing(
  options: TcgcsvFetchOptions,
  dependencies: FetchDependencies = {},
): Promise<{ feed: ProviderPriceFeed; release: string; groups: number }> {
  if (!Number.isSafeInteger(options.categoryId) || options.categoryId <= 0)
    throw new Error('TCGCSV category ID must be a positive integer')
  const request = dependencies.fetch ?? fetch
  const wait =
    dependencies.delay ??
    ((milliseconds: number) =>
      new Promise<void>((resolveDelay) =>
        setTimeout(resolveDelay, milliseconds),
      ))
  const delayMs = Math.max(100, options.minimumDelayMs ?? 100)
  const base = options.baseUrl ?? 'https://tcgcsv.com'
  const userAgent =
    options.userAgent ?? 'CadenceCatalog/0.1.0 (+https://cadencetcg.dev)'
  const get = async (url: string): Promise<unknown> => {
    const response = await request(url, {
      headers: { 'user-agent': userAgent, accept: 'application/json' },
      signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok)
      throw new Error(
        `TCGCSV request failed: ${response.status} ${response.statusText}`,
      )
    return response.json()
  }
  const updatedResponse = await request(endpoint(base, 'last-updated.txt'), {
    headers: { 'user-agent': userAgent, accept: 'text/plain' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!updatedResponse.ok)
    throw new Error(
      `TCGCSV timestamp request failed: HTTP ${updatedResponse.status}`,
    )
  const updatedText = (await updatedResponse.text()).trim()
  const updated = new Date(updatedText)
  if (Number.isNaN(updated.valueOf()))
    throw new Error(
      `TCGCSV returned an invalid last-updated timestamp: ${updatedText}`,
    )
  const fetchedAt = updated.toISOString()
  const release = fetchedAt.replace(/[:.]/g, '-').replace('Z', 'Z')
  const root = resolve(options.output, release, String(options.categoryId))
  const groupsUrl = endpoint(base, `tcgplayer/${options.categoryId}/groups`)
  const groupsPath = join(root, 'groups.json')
  const groupsCached = await exists(groupsPath)
  let groupsValue: unknown
  if (groupsCached)
    groupsValue = JSON.parse(await readFile(groupsPath, 'utf8')) as unknown
  else {
    groupsValue = await get(groupsUrl)
    await writeJson(groupsPath, groupsValue)
  }
  const groups = responseResults<TcgcsvGroup>(groupsValue, 'TCGCSV groups')
  if (groups.length > 9_999)
    throw new Error('Refusing a TCGCSV sync larger than 10,000 group requests')
  const observations: ProviderPriceObservation[] = []
  for (const [index, group] of groups.entries()) {
    if (!Number.isSafeInteger(group.groupId) || group.groupId <= 0)
      throw new Error('TCGCSV returned an invalid group ID')
    const pricesUrl = endpoint(
      base,
      `tcgplayer/${options.categoryId}/${group.groupId}/prices`,
    )
    const pricesPath = join(root, 'prices', `${group.groupId}.json`)
    let pricesValue: unknown
    if (await exists(pricesPath))
      pricesValue = JSON.parse(await readFile(pricesPath, 'utf8')) as unknown
    else {
      if (index || !groupsCached) await wait(delayMs)
      pricesValue = await get(pricesUrl)
      await writeJson(pricesPath, pricesValue)
    }
    for (const price of responseResults<TcgcsvPrice>(
      pricesValue,
      `TCGCSV prices for group ${group.groupId}`,
    )) {
      if (!Number.isSafeInteger(price.productId) || price.productId <= 0)
        throw new Error(
          `TCGCSV returned an invalid product ID in group ${group.groupId}`,
        )
      const market = minor(price.marketPrice)
      const low = minor(price.lowPrice)
      const mid = minor(price.midPrice)
      const high = minor(price.highPrice)
      const prices = {
        ...(market !== undefined ? { market } : {}),
        ...(low !== undefined ? { low } : {}),
        ...(mid !== undefined ? { mid } : {}),
        ...(high !== undefined ? { high } : {}),
      }
      if (!Object.keys(prices).length) continue
      observations.push({
        providerProductId: String(price.productId),
        observedAt: fetchedAt,
        currency: 'USD',
        ...(price.subTypeName ? { finish: price.subTypeName } : {}),
        channel: 'retail',
        prices,
        sourceUrl: pricesUrl,
      })
    }
  }
  const feed: ProviderPriceFeed = {
    schemaVersion: 1,
    provider: 'tcgcsv',
    externalIdKey: 'tcgplayer.productId',
    fetchedAt,
    observations,
  }
  await writeJson(join(root, 'feed.json'), feed)
  return { feed, release, groups: groups.length }
}
