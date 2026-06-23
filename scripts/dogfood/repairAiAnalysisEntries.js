/**
 * scripts/dogfood/repairAiAnalysisEntries.js
 *
 * Repairs legacy "AI Analysis" journal entries — the ones produced by the old
 * playbook-executor fallback, which stored a raw (often truncated) JSON blob as
 * a single note that renders as unreadable JSON.
 *
 * For each such entry it runs the tolerant parser (runtime/parseAgentEntries.js)
 * to recover the readable markdown, then:
 *   - 1 recovered entry  → updates the row in place (keeps id, created_at, order)
 *   - >1 recovered        → inserts them at the original timestamp, deletes the blob
 *   - 0 recovered         → leaves the entry untouched and reports it
 *
 * Idempotent: once repaired, the "AI Analysis" title is gone, so re-runs are no-ops.
 *
 *   node scripts/dogfood/repairAiAnalysisEntries.js
 */
import { query, getClient } from '../../db/postgres.js'
import { parseAgentEntries } from '../../runtime/parseAgentEntries.js'

const FALLBACK_TITLE = 'AI Analysis'

async function main() {
  const { rows } = await query(
    `SELECT id, work_item_id, type, title, content, visibility, tags, author_id, is_agent, created_at
     FROM runtime.context_entries WHERE title = $1 ORDER BY id`, [FALLBACK_TITLE])

  if (!rows.length) { console.log('No "AI Analysis" entries to repair.'); process.exit(0) }
  console.log(`Found ${rows.length} "AI Analysis" entr${rows.length === 1 ? 'y' : 'ies'}.`)

  let repaired = 0, skipped = 0

  for (const e of rows) {
    const { entries } = parseAgentEntries(e.content)
    if (!entries.length) {
      console.log(`  ! entry ${e.id} (item ${e.work_item_id}): nothing recoverable — left as-is`)
      skipped++
      continue
    }

    const client = await getClient()
    try {
      await client.query('BEGIN')
      if (entries.length === 1) {
        const r = entries[0]
        await client.query(
          `UPDATE runtime.context_entries SET type = $2, title = $3, content = $4, updated_at = NOW() WHERE id = $1`,
          [e.id, r.type, r.title || null, r.content])
      } else {
        for (let k = 0; k < entries.length; k++) {
          const r = entries[k]
          await client.query(`
            INSERT INTO runtime.context_entries
              (work_item_id, type, title, content, visibility, tags, author_id, is_agent, created_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8, $9::timestamptz + ($10 || ' milliseconds')::interval, NOW())
          `, [e.work_item_id, r.type, r.title || null, r.content, e.visibility, e.tags, e.author_id, e.is_agent, e.created_at, k])
        }
        await client.query('DELETE FROM runtime.context_entries WHERE id = $1', [e.id])
      }
      await client.query('COMMIT')
      console.log(`  ✓ entry ${e.id} (item ${e.work_item_id}): recovered ${entries.length} — "${(entries[0].title || '').slice(0, 40)}"`)
      repaired++
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      console.error(`  ✗ entry ${e.id}: ${err.message}`)
      skipped++
    } finally {
      client.release()
    }
  }

  console.log(`Done. ${repaired} repaired, ${skipped} skipped.`)
  process.exit(0)
}

main().catch((err) => { console.error(err); process.exit(1) })
