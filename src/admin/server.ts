import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  applyChangeSets,
  loadChangeSets,
  validateChangeSetFile,
  type AdminEntityType,
  type CatalogChangeSet,
} from './changesets.js'
import { loadAdminCatalog } from './workspace.js'
import { proposeWithCodex } from './codex.js'
import { writeJson } from '../util/json.js'

const workspace = process.cwd()
const host = '127.0.0.1'
const port = Number(process.env.CADENCE_ADMIN_PORT ?? 4317)
const token = randomBytes(24).toString('hex')
const changesPath = resolve(workspace, 'config/admin/change-sets.json')
const snapshotRoot = resolve(
  workspace,
  process.env.CADENCE_SNAPSHOT_ROOT ?? 'snapshots/tcgjson/current',
)

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(value))
}

async function body(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  const bytes = Buffer.concat(chunks)
  if (bytes.length > 2_000_000) throw new Error('Request body is too large')
  return JSON.parse(bytes.toString('utf8')) as Record<string, unknown>
}

function authorized(request: IncomingMessage, url: URL): boolean {
  return (
    url.searchParams.get('token') === token ||
    request.headers['x-cadence-admin-token'] === token
  )
}

async function main(): Promise<void> {
  const catalog = await loadAdminCatalog(snapshotRoot)
  const html = await readFile(
    resolve(workspace, 'admin/web/index.html'),
    'utf8',
  )
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${host}:${port}`)
      if (!authorized(request, url)) {
        json(response, 403, { error: 'Invalid local admin token' })
        return
      }
      if (request.method === 'GET' && url.pathname === '/') {
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        })
        response.end(html.replaceAll('__ADMIN_TOKEN__', token))
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/records') {
        const entity = (url.searchParams.get('entity') ?? 'set') as Exclude<
          AdminEntityType,
          'sealed-product'
        >
        if (!['set', 'card', 'printing'].includes(entity))
          throw new Error('Unsupported entity')
        const game = url.searchParams.get('game') ?? 'pokemon'
        const search = (url.searchParams.get('search') ?? '').toLowerCase()
        const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0))
        const limit = Math.min(
          500,
          Math.max(1, Number(url.searchParams.get('limit') ?? 100)),
        )
        const gameIds = new Set(
          catalog.games
            .filter((item) => item.slug === game)
            .map((item) => item.id),
        )
        const setById = new Map(catalog.sets.map((item) => [item.id, item]))
        const source =
          entity === 'set'
            ? catalog.sets
            : entity === 'card'
              ? catalog.cards
              : catalog.printings
        const records = source.filter((record) => {
          const gameId =
            'gameId' in record
              ? record.gameId
              : setById.get(record.setId)?.gameId
          return Boolean(
            gameId &&
            gameIds.has(gameId) &&
            (!search || JSON.stringify(record).toLowerCase().includes(search)),
          )
        })
        json(response, 200, {
          total: records.length,
          offset,
          records: records.slice(offset, offset + limit),
          games: catalog.games,
        })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/propose') {
        const input = await body(request)
        const ids = Array.isArray(input.ids)
          ? input.ids.filter((id): id is string => typeof id === 'string')
          : []
        const entity = String(input.entity) as
          'set' | 'card' | 'printing' | 'sealed-product'
        const source =
          entity === 'set'
            ? catalog.sets
            : entity === 'card'
              ? catalog.cards
              : entity === 'printing'
                ? catalog.printings
                : []
        const records = source.filter((record) => ids.includes(record.id))
        const proposal = await proposeWithCodex(
          {
            instruction: String(input.instruction ?? ''),
            entity,
            game: String(input.game ?? ''),
            records,
          },
          workspace,
        )
        const clone = structuredClone(catalog)
        const preview = applyChangeSets(
          clone,
          { schemaVersion: 1, changeSets: [proposal] },
          true,
        )
        json(response, 200, { proposal, preview })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/save') {
        const input = await body(request)
        const proposal = input.proposal as unknown as CatalogChangeSet
        proposal.status = 'draft'
        proposal.createdBy = proposal.createdBy || 'local-admin'
        delete proposal.approvedBy
        delete proposal.approvedAt
        const existing = (await loadChangeSets(changesPath)) ?? {
          schemaVersion: 1 as const,
          changeSets: [],
        }
        if (existing.changeSets.some((item) => item.id === proposal.id))
          throw new Error(`Change-set id already exists: ${proposal.id}`)
        const next = validateChangeSetFile({
          schemaVersion: 1,
          changeSets: [...existing.changeSets, proposal],
        })
        await writeJson(changesPath, next)
        json(response, 201, { saved: proposal.id })
        return
      }
      json(response, 404, { error: 'Not found' })
    } catch (error) {
      json(response, 400, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
  server.listen(port, host, () =>
    console.log(
      `Cadence catalog admin: http://${host}:${port}/?token=${token}`,
    ),
  )
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
