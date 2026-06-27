/**
 * scripts/post-merge-sweep.js
 * Post-merge sweep: detect merged GitHub PRs, set pr_status='merged' on the
 * matching Gladius work items, and transition them to Done.
 *
 * Intended to be run after a human merges a batch of grinder PRs.  The board
 * items stay in Review after merge because the Done exit criterion requires
 * pr_status=merged — this script automates that final step.
 *
 * Usage:
 *   node scripts/post-merge-sweep.js           # dry run — list candidates, no changes
 *   node scripts/post-merge-sweep.js --confirm  # apply changes
 *
 * Requirements:
 *   - PostgreSQL reachable (config loaded from .env)
 *   - `gh` CLI authenticated (runs `gh pr view` for each PR)
 *   - GLADIUS_AGENT_USER_ID in .env (actor for audit trail; logged as null if absent)
 */

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { query, getClient, pool } from '../db/postgres.js'
import { executeTransition }      from '../runtime/transitions.js'
import { emitEvent }              from '../core/events.js'

const confirm  = process.argv.includes('--confirm')
const ACTOR_ID = process.env.GLADIUS_AGENT_USER_ID
  ? parseInt(process.env.GLADIUS_AGENT_USER_ID, 10)
  : null

// =============================================================================
// QUERY — items that might need sweeping
// =============================================================================

async function findCandidates() {
  const { rows } = await query(`
    SELECT wi.id,
           wi.display_key,
           wi.field_values,
           wi.current_stage_id,
           wi.uri,
           wi.owner_org_id,
           s.name AS stage_name
    FROM runtime.work_items wi
    JOIN blueprint.stages s ON s.id = wi.current_stage_id
    WHERE wi.field_values->>'pr_url' IS NOT NULL
      AND wi.field_values->>'pr_url' <> ''
      AND (
        wi.field_values->>'pr_status' IS NULL
        OR wi.field_values->>'pr_status' <> 'merged'
      )
      AND s.is_terminal = false
    ORDER BY wi.id
  `)
  return rows
}

// =============================================================================
// GITHUB — check if a PR has been merged
// =============================================================================

function checkGitHubState(prUrl) {
  try {
    // execFileSync avoids shell interpolation — prUrl is passed as a discrete arg
    const out = execFileSync('gh', ['pr', 'view', prUrl, '--json', 'state'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return JSON.parse(out.trim()).state  // 'OPEN' | 'CLOSED' | 'MERGED'
  } catch (err) {
    const msg = String(err.stderr || err.message || err).split('\n')[0].trim()
    throw new Error(msg)
  }
}

// =============================================================================
// UPDATE — flip pr_status to 'merged' via JSONB merge, emit audit event
// =============================================================================

async function setPrStatusMerged(item) {
  const client = await getClient()
  try {
    await client.query('BEGIN')

    const { rows: [updated] } = await client.query(`
      UPDATE runtime.work_items
      SET field_values = field_values || '{"pr_status":"merged"}'::jsonb,
          updated_at   = NOW()
      WHERE id = $1
      RETURNING *
    `, [item.id])

    await emitEvent(client, {
      eventType: 'work_item.edited',
      entityId:  item.id,
      entityUri: item.uri,
      actorId:   ACTOR_ID,
      payload: {
        edit_group_id: randomUUID(),
        changes: [{
          field: 'field_values',
          type:  'json',
          old:   item.field_values,
          new:   updated.field_values,
        }],
        current: updated,
      },
    })

    await client.query('COMMIT')
    return updated
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

// =============================================================================
// TRANSITION — find and execute the outgoing Done transition
// =============================================================================

async function findDoneTransition(fromStageId) {
  const { rows } = await query(`
    SELECT st.to_stage_id, s.name AS to_stage_name
    FROM blueprint.stage_transitions st
    JOIN blueprint.stages s ON s.id = st.to_stage_id
    WHERE st.from_stage_id = $1
      AND s.is_terminal = true
      AND s.stage_class != 'cancelled'
      AND st.is_active = true
    LIMIT 1
  `, [fromStageId])
  return rows[0] || null
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const candidates = await findCandidates()

  if (!candidates.length) {
    console.log('No candidates found (no items with pr_url set and pr_status != merged in non-terminal stages).')
    return
  }

  console.log(`\nFound ${candidates.length} candidate(s):\n`)
  for (const c of candidates) {
    console.log(
      `  [${String(c.id).padStart(5)}] ${c.display_key.padEnd(12)} ` +
      `stage: ${c.stage_name.padEnd(14)} pr_url: ${c.field_values.pr_url}`
    )
  }
  console.log()

  const counters = {
    done:             0,
    wouldAct:         0,
    notMerged:        0,
    ghError:          0,
    fieldError:       0,
    noTransition:     0,
    transitionFailed: 0,
  }

  for (const item of candidates) {
    const prUrl = item.field_values.pr_url
    process.stdout.write(`  ${item.display_key}: `)

    // ── Check GitHub ──────────────────────────────────────────────────────────
    let ghState
    try {
      ghState = checkGitHubState(prUrl)
    } catch (err) {
      process.stdout.write(`gh error — ${err.message}\n`)
      counters.ghError++
      continue
    }

    if (ghState !== 'MERGED') {
      process.stdout.write(`${ghState} — not merged, skipping\n`)
      counters.notMerged++
      continue
    }

    // PR is merged
    if (!confirm) {
      process.stdout.write(`MERGED — would set pr_status=merged + transition to Done\n`)
      counters.wouldAct++
      continue
    }

    // ── Set pr_status='merged' ────────────────────────────────────────────────
    try {
      await setPrStatusMerged(item)
      process.stdout.write(`MERGED → pr_status=merged `)
    } catch (err) {
      process.stdout.write(`field update failed: ${err.message}\n`)
      counters.fieldError++
      continue
    }

    // ── Transition to Done ────────────────────────────────────────────────────
    const doneTransition = await findDoneTransition(item.current_stage_id)
    if (!doneTransition) {
      process.stdout.write(`— no active Done transition from "${item.stage_name}"\n`)
      counters.noTransition++
      continue
    }

    const result = await executeTransition(item.id, doneTransition.to_stage_id, ACTOR_ID, {})
    if (!result.success) {
      process.stdout.write(`— transition to ${doneTransition.to_stage_name} failed: ${result.error}\n`)
      if (result.details?.blockedCriteria?.length) {
        for (const c of result.details.blockedCriteria) {
          console.log(`      blocked by: ${c.name}: ${c.reason}`)
        }
      }
      counters.transitionFailed++
    } else {
      process.stdout.write(`→ Done\n`)
      counters.done++
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('\n─── Summary ' + '─'.repeat(40))
  if (!confirm) {
    console.log(`DRY RUN: ${counters.wouldAct} item(s) ready to move to Done.`)
    if (counters.notMerged) console.log(`  Not yet merged:   ${counters.notMerged}`)
    if (counters.ghError)   console.log(`  GitHub errors:    ${counters.ghError}`)
    console.log()
    console.log('Re-run with --confirm to apply changes.')
  } else {
    console.log(`Transitioned to Done:   ${counters.done}`)
    if (counters.notMerged)        console.log(`Not yet merged:         ${counters.notMerged}`)
    if (counters.ghError)          console.log(`GitHub errors:          ${counters.ghError}`)
    if (counters.fieldError)       console.log(`Field update errors:    ${counters.fieldError}`)
    if (counters.noTransition)     console.log(`No Done transition:     ${counters.noTransition}`)
    if (counters.transitionFailed) console.log(`Transition blocked:     ${counters.transitionFailed}`)
  }
}

main()
  .catch(err => { console.error('\nFatal:', err.message); process.exit(1) })
  .finally(() => pool.end())
