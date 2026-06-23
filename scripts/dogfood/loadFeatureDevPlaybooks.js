/**
 * scripts/dogfood/loadFeatureDevPlaybooks.js
 *
 * Idempotent loader for the Feature Development workflow playbooks. Reads the
 * markdown source in ./playbooks/*.md and upserts each into
 * blueprint.stage_playbooks by stage, setting wit_type_id = NULL so the playbook
 * applies to ALL work item types in the workflow (the old Discovery/Planning
 * playbooks were incorrectly bound to the Feature type only).
 *
 * The playbooks are version-controlled here (they previously lived only in the
 * DB). Edit the .md files, re-run this loader.
 *
 * Also ensures a `sonnet` AI model config exists for the org (the redesigned
 * Discovery/Planning playbooks declare `model: sonnet`), reusing the encrypted
 * key from the existing `default` model — no re-encryption needed.
 *
 *   node scripts/dogfood/loadFeatureDevPlaybooks.js
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { query } from '../../db/postgres.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const WORKFLOW_NAME = 'Feature Development'
const ORG_SLUG = 'flowos-dev'

// stage display name → { file, playbook name }
const PLAYBOOKS = [
  { stage: 'Discovery',  file: 'discovery.md',  name: 'Discovery' },
  { stage: 'Planning',   file: 'planning.md',   name: 'Planning Brief' },
  { stage: 'Dev/Test',   file: 'dev-test.md',   name: 'Dev/Test Brief' },
  { stage: 'Review',     file: 'review.md',     name: 'Review Brief' },
  { stage: 'Deployment', file: 'deployment.md', name: 'Deployment Brief' },
]

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

async function ensureSonnetModel() {
  const { rows } = await query(
    `SELECT m.id FROM blueprint.org_ai_models m
     JOIN blueprint.organizations o ON o.id = m.org_id
     WHERE o.slug = $1 AND m.name = 'sonnet'`, [ORG_SLUG])
  if (rows.length) { console.log('  = AI model "sonnet" already present'); return }

  const ins = await query(`
    INSERT INTO blueprint.org_ai_models (org_id, name, provider, model, api_key_enc, is_active)
    SELECT m.org_id, 'sonnet', m.provider, 'claude-sonnet-4-6', m.api_key_enc, true
    FROM blueprint.org_ai_models m
    JOIN blueprint.organizations o ON o.id = m.org_id
    WHERE o.slug = $1 AND m.name = 'default'
    RETURNING id
  `, [ORG_SLUG])
  if (!ins.rows.length) throw new Error('No "default" model to copy the key from — configure a default model first')
  console.log('  ✓ AI model "sonnet" created (claude-sonnet-4-6, key reused from default)')
}

async function upsertPlaybook(stageId, name, content) {
  const upd = await query(`
    UPDATE blueprint.stage_playbooks
    SET name = $2, content = $3, wit_type_id = NULL, is_active = true, updated_at = NOW()
    WHERE stage_id = $1 AND is_active = true
  `, [stageId, name, content])
  if (upd.rowCount > 0) return `updated (${upd.rowCount})`

  await query(`
    INSERT INTO blueprint.stage_playbooks (stage_id, wit_type_id, name, content, is_active)
    VALUES ($1, NULL, $2, $3, true)
  `, [stageId, name, content])
  return 'inserted'
}

async function main() {
  await ensureSonnetModel()
  const stageIds = await resolveStageIds()

  for (const pb of PLAYBOOKS) {
    const stageId = stageIds.get(pb.stage)
    if (!stageId) throw new Error(`Stage "${pb.stage}" not found in ${WORKFLOW_NAME} / ${ORG_SLUG}`)
    const content = readFileSync(join(HERE, 'playbooks', pb.file), 'utf8')
    const action = await upsertPlaybook(stageId, pb.name, content)
    console.log(`  ✓ ${pb.stage}: "${pb.name}" ${action}`)
  }
  console.log('Done.')
  process.exit(0)
}

main().catch((err) => { console.error(err); process.exit(1) })
