/**
 * scripts/cleanupDogfoodOrphans.js
 * Remove orphaned user references from the dogfood database:
 *
 *   1. runtime.work_item_user_relationships rows whose user_id no longer
 *      exists in blueprint.users — these caused the notification subscriber
 *      to crash-loop with FK violations (DEBT.25359).
 *   2. runtime.work_items.requester_id values referencing a deleted user.
 *
 * The notification subscriber already has a runtime guard (added in DEBT.25476)
 * that silently skips orphaned user_ids, so these rows are no longer crash-
 * inducing.  This script removes them for data hygiene and to confirm the
 * board is clean.
 *
 * Usage:
 *   node scripts/cleanupDogfoodOrphans.js              # dry run — list counts
 *   node scripts/cleanupDogfoodOrphans.js --confirm    # actually remove
 */

import pg from 'pg'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env manually (no dotenv dependency required for standalone scripts)
try {
  const envPath = join(__dirname, '..', '.env')
  const lines = readFileSync(envPath, 'utf8').split('\n')
  for (const line of lines) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] ??= m[2].trim()
  }
} catch { /* .env optional */ }

const pool = new pg.Pool({
  host:     process.env.POSTGRES_HOST     || 'localhost',
  port:     Number(process.env.POSTGRES_PORT) || 5432,
  database: process.env.POSTGRES_DB       || 'flowos',
  user:     process.env.POSTGRES_USER     || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres',
})

async function main() {
  const confirm = process.argv.includes('--confirm')
  const client  = await pool.connect()

  try {
    // ── 1. Orphaned work_item_user_relationships ──────────────────────────────
    const { rows: orphanRels } = await client.query(`
      SELECT wur.work_item_id, wur.user_id, wur.relationship_type
      FROM   runtime.work_item_user_relationships wur
      WHERE  NOT EXISTS (
               SELECT 1 FROM blueprint.users u WHERE u.id = wur.user_id
             )
      ORDER  BY wur.user_id, wur.work_item_id
    `)

    if (orphanRels.length === 0) {
      console.log('No orphaned work_item_user_relationships rows found.')
    } else {
      console.log(`\nOrphaned work_item_user_relationships: ${orphanRels.length} row(s)`)
      // Summarise by user_id to keep output compact
      const byUser = {}
      for (const r of orphanRels) {
        byUser[r.user_id] = (byUser[r.user_id] ?? 0) + 1
      }
      for (const [uid, count] of Object.entries(byUser)) {
        console.log(`  user_id=${uid}  ${count} relationship(s)`)
      }
    }

    // ── 2. Work items with orphaned requester_id ──────────────────────────────
    const { rows: orphanReq } = await client.query(`
      SELECT wi.id, wi.display_key, wi.requester_id
      FROM   runtime.work_items wi
      WHERE  wi.requester_id IS NOT NULL
        AND  NOT EXISTS (
               SELECT 1 FROM blueprint.users u WHERE u.id = wi.requester_id
             )
      ORDER  BY wi.id
    `)

    if (orphanReq.length === 0) {
      console.log('No work items with orphaned requester_id found.')
    } else {
      console.log(`\nWork items with orphaned requester_id: ${orphanReq.length} row(s)`)
      for (const r of orphanReq) {
        console.log(`  [${r.id}] ${(r.display_key || '(no key)').padEnd(14)} requester_id=${r.requester_id}`)
      }
    }

    // ── Summary + guard ───────────────────────────────────────────────────────
    const totalIssues = orphanRels.length + orphanReq.length
    if (totalIssues === 0) {
      console.log('\nDatabase is clean — nothing to do.')
      return
    }

    if (!confirm) {
      console.log(`\nDRY RUN — no changes made.`)
      console.log(`Re-run with --confirm to remove ${totalIssues} orphaned reference(s).`)
      return
    }

    // ── 3. Apply fixes ────────────────────────────────────────────────────────
    await client.query('BEGIN')

    let relsDeleted = 0
    if (orphanRels.length > 0) {
      const { rowCount } = await client.query(`
        DELETE FROM runtime.work_item_user_relationships
        WHERE user_id NOT IN (SELECT id FROM blueprint.users)
      `)
      relsDeleted = rowCount
    }

    let reqNulled = 0
    if (orphanReq.length > 0) {
      const { rowCount } = await client.query(`
        UPDATE runtime.work_items
        SET    requester_id = NULL,
               updated_at   = NOW()
        WHERE  requester_id IS NOT NULL
          AND  requester_id NOT IN (SELECT id FROM blueprint.users)
      `)
      reqNulled = rowCount
    }

    await client.query('COMMIT')

    console.log(`\nDone:`)
    console.log(`  Deleted ${relsDeleted} orphaned work_item_user_relationships row(s)`)
    console.log(`  Nulled  ${reqNulled} orphaned requester_id value(s)`)
    console.log(`\nThe notification subscriber can now process events without FK violations.`)

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('Error — rolled back:', err.message)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

main()
