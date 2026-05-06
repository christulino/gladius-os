/**
 * scripts/backfillSearchIndex.js
 * Idempotent backfill of runtime.work_item_search.
 * Usage: node scripts/backfillSearchIndex.js
 */

import { query, pool } from '../db/postgres.js'
import { searchIndexHandler } from '../runtime/subscribers/searchIndex.js'

async function main() {
  const t0 = Date.now()
  const { rows } = await query('SELECT id FROM runtime.work_items ORDER BY id')
  console.log(`Backfilling search index for ${rows.length} work items...`)

  let done = 0
  for (const { id } of rows) {
    try {
      await searchIndexHandler({
        event_type: 'work_item.created',
        entity_type: 'work_item',
        entity_id: id,
      })
      done++
      if (done % 100 === 0) process.stdout.write(`\r  ${done}/${rows.length}`)
    } catch (err) {
      console.error(`\n  failed work_item ${id}: ${err.message}`)
    }
  }
  process.stdout.write(`\r  ${done}/${rows.length}\n`)
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s.`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
