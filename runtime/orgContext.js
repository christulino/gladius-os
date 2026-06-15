// runtime/orgContext.js
import { pool } from '../db/postgres.js'

export async function listOrgContext(orgId, { types } = {}) {
  const params = [orgId]
  let typeFilter = ''
  if (types?.length) { params.push(types); typeFilter = `AND type=ANY($${params.length})` }
  const r = await pool.query(`
    SELECT oc.*, u.display_name AS author_name
    FROM blueprint.org_context oc
    LEFT JOIN blueprint.users u ON u.id = oc.author_id
    WHERE oc.org_id=$1 ${typeFilter}
    ORDER BY oc.type, oc.created_at DESC
  `, params)
  return r.rows
}

export async function createOrgContext(orgId, { type, title, content, tags = [], authorId }) {
  const r = await pool.query(`
    INSERT INTO blueprint.org_context (org_id,type,title,content,tags,author_id)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
  `, [orgId, type, title, content, tags, authorId || null])
  return r.rows[0]
}

export async function updateOrgContext(id, orgId, { type, title, content, tags }) {
  const sets = ['is_edited=true','updated_at=now()'], params = []
  if (type    !== undefined) { params.push(type);    sets.push(`type=$${params.length}`) }
  if (title   !== undefined) { params.push(title);   sets.push(`title=$${params.length}`) }
  if (content !== undefined) { params.push(content); sets.push(`content=$${params.length}`) }
  if (tags    !== undefined) { params.push(tags);    sets.push(`tags=$${params.length}`) }
  params.push(id, orgId)
  const r = await pool.query(
    `UPDATE blueprint.org_context SET ${sets.join(',')} WHERE id=$${params.length - 1} AND org_id=$${params.length} RETURNING *`,
    params
  )
  return r.rows[0] || null
}

export async function deleteOrgContext(id, orgId) {
  const r = await pool.query(
    `DELETE FROM blueprint.org_context WHERE id=$1 AND org_id=$2 RETURNING id`,
    [id, orgId]
  )
  return r.rowCount > 0
}
