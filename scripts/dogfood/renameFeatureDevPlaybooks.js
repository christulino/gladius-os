/**
 * scripts/dogfood/renameFeatureDevPlaybooks.js
 *
 * Idempotent: rewrites stale "FlowOS" / "$FLOWOS_API_KEY" strings in the
 * Feature Development workflow playbooks to "Gladius" / "$GLADIUS_API_KEY".
 * Text-only; no behavior change. Safe to run anytime, any number of times.
 *
 *   node scripts/dogfood/renameFeatureDevPlaybooks.js
 */
import { query } from '../../db/postgres.js'

const WORKFLOW_NAME = 'Feature Development'
const ORG_SLUG = 'flowos-dev'

const REPLACEMENTS = [
  [/\$FLOWOS_API_KEY/g, '$GLADIUS_API_KEY'],
  [/FlowOS/g, 'Gladius'],
]

async function main() {
  const { rows: playbooks } = await query(`
    SELECT p.id, p.name, p.content
    FROM blueprint.stage_playbooks p
    JOIN blueprint.stages s    ON s.id = p.stage_id
    JOIN blueprint.workflows w ON w.id = s.workflow_id
    JOIN blueprint.organizations o ON o.id = w.owner_org_id
    WHERE w.name = $1 AND o.slug = $2
  `, [WORKFLOW_NAME, ORG_SLUG])

  let changed = 0
  for (const p of playbooks) {
    let next = p.content
    for (const [pattern, repl] of REPLACEMENTS) next = next.replace(pattern, repl)
    if (next === p.content) {
      console.log(`  = "${p.name}" already clean`)
      continue
    }
    await query('UPDATE blueprint.stage_playbooks SET content = $2, updated_at = NOW() WHERE id = $1', [p.id, next])
    console.log(`  ✓ "${p.name}" updated`)
    changed++
  }
  console.log(`Done. ${changed} playbook(s) changed, ${playbooks.length - changed} already clean.`)
  process.exit(0)
}

main().catch((err) => { console.error(err); process.exit(1) })
