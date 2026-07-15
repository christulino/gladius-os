/**
 * tests/api-token-hash.test.js
 *
 * DEBT.26612 — Hash API tokens at rest.
 *
 * Verifies core/auth.js#findUserByApiToken against the migration-027 schema
 * (blueprint.users.api_token_hash). Covers:
 *   (a) a migration-backfilled row (plaintext + hash) resolves via the HASH path
 *   (b) a wrong token returns null
 *   (c) a fresh plaintext-only row resolves via the fallback AND gets its
 *       api_token_hash backfilled (hash-on-use)
 *   (d) the fos_ak_ prefix guard rejects non-prefixed tokens
 *   (e) zero-breakage sanity — a known fos_ak_ token whose hash was backfilled
 *       (exactly as migration 027 does) still authenticates
 *
 * CI-isolation-clean: every user is self-inserted with a random uri/email/token
 * and deleted in teardown. No dogfood user IDs are referenced. No server needed
 * (findUserByApiToken talks to the DB directly via db/postgres.js).
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { query } from '../db/postgres.js'
import { findUserByApiToken } from '../core/auth.js'
import { closePool } from './helpers/poolTeardown.js'

const sha256hex = (t) => crypto.createHash('sha256').update(t).digest('hex')

const createdUserIds = []

/**
 * Insert a throwaway user directly. `hashToken` mirrors what migration 027's
 * backfill does; pass false to simulate a legacy plaintext-only row.
 */
async function insertUser({ token, hashToken }) {
  const suffix = randomUUID()
  const { rows } = await query(
    `INSERT INTO blueprint.users (uri, email, display_name, is_active, api_token, api_token_hash)
     VALUES ($1, $2, $3, true, $4, $5)
     RETURNING id`,
    [
      `flowos://test/users/${suffix}`,
      `debt26612-${suffix}@test.local`,
      'DEBT.26612 test user',
      token,
      hashToken && token ? sha256hex(token) : null,
    ]
  )
  createdUserIds.push(rows[0].id)
  return rows[0].id
}

before(async () => {
  // Guard: migration 027 must be applied to the target DB.
  const { rows } = await query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'blueprint' AND table_name = 'users'
       AND column_name = 'api_token_hash'`
  )
  assert.equal(rows.length, 1, 'blueprint.users.api_token_hash must exist (run migration 027)')
})

after(async () => {
  if (createdUserIds.length > 0) {
    await query('DELETE FROM blueprint.users WHERE id = ANY($1::int[])', [createdUserIds])
  }
})

test('(a) migration-backfilled row resolves via the hash path', async () => {
  const token = `fos_ak_${randomUUID().replace(/-/g, '')}`
  const id = await insertUser({ token, hashToken: true })

  const user = await findUserByApiToken(token)
  assert.ok(user, 'user should resolve')
  assert.equal(user.id, id)
})

test('(b) a wrong token returns null', async () => {
  const token = `fos_ak_${randomUUID().replace(/-/g, '')}`
  await insertUser({ token, hashToken: true })

  const user = await findUserByApiToken(`fos_ak_${randomUUID().replace(/-/g, '')}`)
  assert.equal(user, null)
})

test('(c) plaintext-only row resolves via fallback and gets hash backfilled', async () => {
  const token = `fos_ak_${randomUUID().replace(/-/g, '')}`
  const id = await insertUser({ token, hashToken: false })

  // Pre-condition: no hash yet.
  const pre = await query('SELECT api_token_hash FROM blueprint.users WHERE id = $1', [id])
  assert.equal(pre.rows[0].api_token_hash, null, 'row should start with NULL hash')

  const user = await findUserByApiToken(token)
  assert.ok(user, 'user should resolve via plaintext fallback')
  assert.equal(user.id, id)

  // Post-condition: hash-on-use backfilled the correct hash.
  const post = await query('SELECT api_token_hash FROM blueprint.users WHERE id = $1', [id])
  assert.equal(post.rows[0].api_token_hash, sha256hex(token), 'hash should be backfilled')

  // And a second lookup now resolves via the hash path (still works).
  const again = await findUserByApiToken(token)
  assert.equal(again.id, id)
})

test('(d) fos_ak_ prefix guard rejects non-prefixed tokens', async () => {
  assert.equal(await findUserByApiToken('not_a_token'), null)
  assert.equal(await findUserByApiToken(''), null)
  assert.equal(await findUserByApiToken(undefined), null)
})

test('(e) zero-breakage: a backfilled known token still authenticates', async () => {
  // Simulate the dogfood row exactly as migration 027 leaves it: plaintext
  // token retained + api_token_hash = sha256(token).
  const token = 'fos_ak_zerobreakage_sanity_check'
  const id = await insertUser({ token, hashToken: true })

  const user = await findUserByApiToken(token)
  assert.ok(user, 'the existing token must keep working post-migration')
  assert.equal(user.id, id)
})

// Close the shared PG pool so this test process can exit cleanly (DEBT.26643).
after(closePool)
