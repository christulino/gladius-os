/**
 * scripts/dogfood/seedFeatureDevGates.js
 *
 * Idempotent: authors the v1 context-sufficiency exit-criteria gates on the
 * Feature Development workflow (org flowos-dev / "Gladius Development").
 *
 *   Discovery → a `discovery` entry AND an `acceptance` entry must exist
 *   Planning  → a `note` entry (the Planning Brief) must exist
 *
 * Each gate uses the `context_entry_exists` codified condition, satisfiable by
 * an agent via the write_context_entry MCP tool.
 *
 * !! ORDER MATTERS !! The API server must already be running code that
 * understands `context_entry_exists` (runtime/exitCriteria.js). Authoring a
 * blocking criterion of an unknown type makes the running server return false
 * for it and PERMANENTLY BLOCK transitions out of the gated stages. Deploy the
 * code and restart the API BEFORE running this script.
 *
 * Upserts by (stage_id, name) so re-running is safe and updates in place.
 *
 *   node scripts/dogfood/seedFeatureDevGates.js
 */
import { randomUUID } from 'node:crypto'
import { query } from '../../db/postgres.js'

const WORKFLOW_NAME = 'Feature Development'
const ORG_SLUG = 'flowos-dev'

// stage display name → list of { name, description, entry_type, min_count }
const GATES = {
  Discovery: [
    {
      name: 'Discovery write-up exists',
      description: 'A discovery context entry must exist before leaving Discovery.',
      entry_type: 'discovery',
      min_count: 1,
    },
    {
      name: 'Draft acceptance criteria exist',
      description: 'An acceptance context entry must exist before leaving Discovery.',
      entry_type: 'acceptance',
      min_count: 1,
    },
  ],
  Planning: [
    {
      name: 'Planning Brief exists',
      description: 'A note context entry (the Planning Brief) must exist before leaving Planning.',
      entry_type: 'note',
      min_count: 1,
    },
  ],
}

async function resolveStageIds() {
  const { rows } = await query(`
    SELECT s.id, s.name
    FROM blueprint.stages s
    JOIN blueprint.workflows w ON w.id = s.workflow_id
    JOIN blueprint.organizations o ON o.id = w.owner_org_id
    WHERE w.name = $1 AND o.slug = $2
  `, [WORKFLOW_NAME, ORG_SLUG])
  return new Map(rows.map((r) => [r.name, r.id]))
}

async function upsertGate(orgSlug, stageId, gate) {
  const condition = JSON.stringify({
    type: 'context_entry_exists',
    entry_type: gate.entry_type,
    min_count: gate.min_count,
  })

  const { rows } = await query(
    'SELECT id FROM blueprint.exit_criteria WHERE stage_id = $1 AND name = $2',
    [stageId, gate.name],
  )

  if (rows.length) {
    await query(`
      UPDATE blueprint.exit_criteria
      SET description = $2, criteria_tier = 'codified', codified_condition = $3,
          is_blocking = true, is_active = true, updated_at = NOW()
      WHERE id = $1
    `, [rows[0].id, gate.description, condition])
    return 'updated'
  }

  await query(`
    INSERT INTO blueprint.exit_criteria
      (uri, stage_id, name, description, criteria_tier, codified_condition, is_blocking, is_active)
    VALUES ($1, $2, $3, $4, 'codified', $5, true, true)
  `, [`flowos://${orgSlug}/criteria/${randomUUID()}`, stageId, gate.name, gate.description, condition])
  return 'inserted'
}

async function main() {
  const stageIds = await resolveStageIds()
  let inserted = 0
  let updated = 0

  for (const [stageName, gates] of Object.entries(GATES)) {
    const stageId = stageIds.get(stageName)
    if (!stageId) throw new Error(`Stage "${stageName}" not found in ${WORKFLOW_NAME} / ${ORG_SLUG}`)
    for (const gate of gates) {
      const action = await upsertGate(ORG_SLUG, stageId, gate)
      console.log(`  ${action === 'inserted' ? '✓' : '~'} ${stageName}: "${gate.name}" (${action})`)
      if (action === 'inserted') inserted++
      else updated++
    }
  }

  console.log(`Done. ${inserted} inserted, ${updated} updated.`)
  process.exit(0)
}

main().catch((err) => { console.error(err); process.exit(1) })
