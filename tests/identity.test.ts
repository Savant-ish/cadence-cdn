import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createIdentity,
  normalizeComponent,
} from '../src/identity/cadence-id.js'

test('normalization is explicit and stable', () => {
  assert.equal(normalizeComponent('Pokémon & Friends!'), 'pokemon-and-friends')
  assert.deepEqual(createIdentity('set', 'pokemon', 'Base Set'), {
    id: 'cadence:set:v1:8b71b6774b75c3cf8be2054e',
    identityKey: 'v1:set:pokemon:base-set',
  })
})

test('empty identity components fail', () => {
  assert.throws(
    () => createIdentity('card', 'pokemon', '***'),
    /Missing card identity component/,
  )
})
