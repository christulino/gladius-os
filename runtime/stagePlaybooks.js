// runtime/stagePlaybooks.js
import { pool } from '../db/postgres.js'
import yaml from 'js-yaml'

export async function getPlaybookForStage(stageId, witTypeId) {
  // stage-specific playbook takes precedence over type default
  const r = await pool.query(`
    SELECT * FROM blueprint.stage_playbooks
    WHERE is_active=true AND (
      (stage_id=$1) OR (wit_type_id=$2 AND stage_id IS NULL)
    )
    ORDER BY CASE WHEN stage_id=$1 THEN 0 ELSE 1 END
    LIMIT 1
  `, [stageId, witTypeId || null])
  return r.rows[0] || null
}

export async function listPlaybooks({ stageId, witTypeId } = {}) {
  const where = [], params = []
  if (stageId)   { params.push(stageId);   where.push(`stage_id=$${params.length}`) }
  if (witTypeId) { params.push(witTypeId); where.push(`wit_type_id=$${params.length}`) }
  const r = await pool.query(`
    SELECT * FROM blueprint.stage_playbooks
    ${where.length ? 'WHERE ' + where.join(' OR ') : ''}
    ORDER BY created_at DESC
  `, params)
  return r.rows
}

export async function createPlaybook({ stageId, witTypeId, name, content }) {
  const r = await pool.query(`
    INSERT INTO blueprint.stage_playbooks (stage_id,wit_type_id,name,content)
    VALUES ($1,$2,$3,$4) RETURNING *
  `, [stageId || null, witTypeId || null, name, content])
  return r.rows[0]
}

export async function updatePlaybook(id, orgId, { name, content, isActive }) {
  const sets = ['updated_at=now()'], params = []
  if (name     !== undefined) { params.push(name);     sets.push(`name=$${params.length}`) }
  if (content  !== undefined) { params.push(content);  sets.push(`content=$${params.length}`) }
  if (isActive !== undefined) { params.push(isActive); sets.push(`is_active=$${params.length}`) }
  params.push(id, orgId)
  // Scope to org via stage→workflow or wit_type — prevents cross-org IDOR
  const r = await pool.query(
    `UPDATE blueprint.stage_playbooks sp SET ${sets.join(',')}
     WHERE sp.id=$${params.length - 1} AND (
       EXISTS (SELECT 1 FROM blueprint.stages s JOIN blueprint.workflows w ON w.id=s.workflow_id WHERE s.id=sp.stage_id AND w.org_id=$${params.length})
       OR EXISTS (SELECT 1 FROM blueprint.work_item_types wit WHERE wit.id=sp.wit_type_id AND wit.org_id=$${params.length})
     )
     RETURNING *`,
    params
  )
  return r.rows[0] || null
}

export async function deletePlaybook(id, orgId) {
  const r = await pool.query(
    `DELETE FROM blueprint.stage_playbooks sp
     WHERE sp.id=$1 AND (
       EXISTS (SELECT 1 FROM blueprint.stages s JOIN blueprint.workflows w ON w.id=s.workflow_id WHERE s.id=sp.stage_id AND w.org_id=$2)
       OR EXISTS (SELECT 1 FROM blueprint.work_item_types wit WHERE wit.id=sp.wit_type_id AND wit.org_id=$2)
     )
     RETURNING id`,
    [id, orgId]
  )
  return r.rowCount > 0
}

// Parse YAML frontmatter from playbook content.
// Returns { meta, body } where meta is the parsed frontmatter object.
export function parsePlaybook(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { meta: {}, body: content }
  try {
    // js-yaml v4: yaml.load() is safe (safeLoad deprecated).
    // JSON_SCHEMA restricts to JSON-compatible types only — no custom tags.
    const meta = yaml.load(match[1], { schema: yaml.JSON_SCHEMA }) || {}
    return { meta, body: match[2].trim() }
  } catch {
    return { meta: {}, body: content }
  }
}
