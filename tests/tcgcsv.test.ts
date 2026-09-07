import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fetchTcgcsvPricing } from '../src/pricing/tcgcsv.js'

test('fetches TCGCSV groups with throttling and creates a provider feed', async () => {
  const output = await mkdtemp(join(tmpdir(), 'cadence-tcgcsv-'))
  const requested: string[] = []
  const delays: number[] = []
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input)
    requested.push(url)
    assert.equal(
      (init?.headers as Record<string, string>)['user-agent'],
      'CadenceTest/1.0',
    )
    if (url.endsWith('last-updated.txt'))
      return new Response('2026-09-07T12:00:00Z')
    if (url.endsWith('/groups'))
      return Response.json({
        success: true,
        errors: [],
        results: [{ groupId: 10 }, { groupId: 20 }],
      })
    const productId = url.includes('/10/') ? 704848 : 704849
    return Response.json({
      success: true,
      errors: [],
      results: [
        {
          productId,
          subTypeName: 'Holofoil',
          lowPrice: 1.1,
          midPrice: 2.22,
          highPrice: null,
          marketPrice: 1.99,
        },
      ],
    })
  }
  const result = await fetchTcgcsvPricing(
    {
      categoryId: 3,
      output,
      baseUrl: 'https://example.test',
      userAgent: 'CadenceTest/1.0',
    },
    {
      fetch: fakeFetch,
      delay: async (milliseconds) => {
        delays.push(milliseconds)
      },
    },
  )
  assert.equal(result.groups, 2)
  assert.equal(result.feed.observations.length, 2)
  assert.deepEqual(result.feed.observations[0]?.prices, {
    market: 199,
    low: 110,
    mid: 222,
  })
  assert.equal(result.feed.observations[0]?.finish, 'Holofoil')
  assert.deepEqual(delays, [100, 100])
  assert.equal(requested.length, 4)

  requested.length = 0
  delays.length = 0
  await fetchTcgcsvPricing(
    {
      categoryId: 3,
      output,
      baseUrl: 'https://example.test',
      userAgent: 'CadenceTest/1.0',
    },
    {
      fetch: fakeFetch,
      delay: async (milliseconds) => {
        delays.push(milliseconds)
      },
    },
  )
  assert.deepEqual(requested, ['https://example.test/last-updated.txt'])
  assert.deepEqual(delays, [])
})
