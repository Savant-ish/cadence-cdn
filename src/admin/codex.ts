import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { delimiter } from 'node:path'
import { existsSync } from 'node:fs'
import type { CatalogChangeSet } from './changesets.js'
import { validateChangeSetFile } from './changesets.js'

export interface ProposalRequest {
  instruction: string
  entity: 'set' | 'card' | 'printing' | 'sealed-product'
  game: string
  records: unknown[]
}

function codexExecutable(): string {
  if (process.platform !== 'win32') return 'codex'
  const candidates = (process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => join(directory.replace(/^"|"$/g, ''), 'codex.exe'))
  const localAppData = process.env.LOCALAPPDATA
  if (localAppData)
    candidates.push(
      join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'),
    )
  const executable = candidates.find((candidate) => existsSync(candidate))
  if (!executable) throw new Error('Codex CLI executable was not found on PATH')
  return executable
}

export async function proposeWithCodex(
  request: ProposalRequest,
  workspace: string,
): Promise<CatalogChangeSet> {
  if (!request.instruction.trim()) throw new Error('An instruction is required')
  if (!request.records.length) throw new Error('Select at least one record')
  if (request.records.length > 200)
    throw new Error('AI proposals are limited to 200 records')
  const temporary = await mkdtemp(join(tmpdir(), 'cadence-admin-'))
  const output = join(temporary, 'proposal.json')
  const schema = resolve(workspace, 'schemas/admin-proposal.schema.json')
  const editable = {
    set: [
      'name',
      'code',
      'releaseDate',
      'classification.eraId',
      'classification.eraName',
      'classification.kind',
      'image.sourceUrl',
      'image.status',
    ],
    card: ['name', 'cardType', 'metadata'],
    printing: [
      'collectorNumber',
      'rarity',
      'language',
      'finish',
      'edition',
      'image.sourceUrl',
      'image.status',
    ],
    'sealed-product': [],
  }[request.entity]
  const prompt = [
    'You are proposing a catalog metadata change set. Return only data matching the output schema.',
    'Never approve the change set. Use status draft and createdBy codex.',
    'Use explicit record IDs in select.ids so the proposal cannot affect unseen records.',
    `Use only these exact editable field paths: ${editable.join(', ')}.`,
    `Entity: ${request.entity}. Game: ${request.game}.`,
    `User instruction: ${request.instruction}`,
    `Selected records: ${JSON.stringify(request.records)}`,
  ].join('\n\n')
  try {
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(
        codexExecutable(),
        [
          'exec',
          '--ephemeral',
          '--sandbox',
          'read-only',
          '--color',
          'never',
          '--output-schema',
          schema,
          '--output-last-message',
          output,
          '-',
        ],
        {
          cwd: workspace,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      )
      let stderr = ''
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.on('error', reject)
      child.on('close', (code) =>
        code === 0
          ? resolvePromise()
          : reject(
              new Error(`Codex exited with ${code}: ${stderr.slice(-2000)}`),
            ),
      )
      child.stdin.end(prompt)
    })
    const raw = JSON.parse(await readFile(output, 'utf8')) as Omit<
      CatalogChangeSet,
      'operations'
    > & {
      operations: Array<{
        entity: CatalogChangeSet['operations'][number]['entity']
        select: CatalogChangeSet['operations'][number]['select']
        changes: Array<{ field: string; value: string }>
      }>
    }
    const proposed: CatalogChangeSet = {
      ...raw,
      operations: raw.operations.map(({ entity, select, changes }) => ({
        entity,
        select,
        set: Object.fromEntries(
          changes.map((item) => [item.field, item.value]),
        ),
      })),
    }
    proposed.status = 'draft'
    proposed.createdBy = 'codex'
    delete proposed.approvedBy
    delete proposed.approvedAt
    return validateChangeSetFile({ schemaVersion: 1, changeSets: [proposed] })
      .changeSets[0]!
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
