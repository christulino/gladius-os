/**
 * runtime/contextEntries.js
 * CRUD module for context_entries — per-work-item journal/discovery notes.
 */

import { pool } from '../db/postgres.js'
import { emitEvent } from '../core/events.js'

/**
 * List context entries for a work item, newest first.
 * Optionally filter by one or more types.
 *
 * @param {number}   workItemId
 * @param {Object}   [opts]
 * @param {string[]} [opts.types] - filter to these entry types
 * @returns {Promise<Object[]>}
 */
export async function listContextEntries(workItemId, { types } = {}) {
  const params = [workItemId]
  let typeFilter = ''
  if (types && types.length > 0) {
    params.push(types)
    typeFilter = `AND ce.type = ANY($${params.length})`
  }
  const r = await pool.query(`
    SELECT ce.*, u.display_name AS author_name
    FROM runtime.context_entries ce
    LEFT JOIN blueprint.users u ON u.id = ce.author_id
    WHERE ce.work_item_id = $1 ${typeFilter}
    ORDER BY ce.created_at DESC, ce.id DESC
  `, params)
  return r.rows
}

/**
 * Create a context entry and emit a work_item.context_entry_added event.
 * Manages its own transaction when no client is passed in.
 *
 * @param {number}  workItemId
 * @param {Object}  opts
 * @param {string}  opts.type
 * @param {string}  [opts.title]
 * @param {string}  opts.content
 * @param {string}  [opts.visibility='item']
 * @param {string[]} [opts.tags=[]]
 * @param {number}  [opts.authorId]
 * @param {boolean} [opts.isAgent=false]
 * @param {Object}  [client] - existing pg client (must be in a transaction)
 * @returns {Promise<Object>} the created entry row
 */
export async function createContextEntry(workItemId, {
  type, title, content, visibility = 'item', tags = [], authorId, isAgent = false,
}, client = null) {
  const needsClient = !client
  const c = needsClient ? await pool.connect() : client

  try {
    if (needsClient) await c.query('BEGIN')

    const r = await c.query(`
      INSERT INTO runtime.context_entries
        (work_item_id, type, title, content, visibility, tags, author_id, is_agent)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [workItemId, type, title || null, content, visibility, tags, authorId || null, isAgent])
    const entry = r.rows[0]

    await emitEvent(c, {
      eventType: 'work_item.context_entry_added',
      entityId:  workItemId,
      actorId:   authorId || null,
      payload:   { entry_id: entry.id, type: entry.type, is_agent: isAgent },
    })

    if (needsClient) await c.query('COMMIT')
    return entry
  } catch (err) {
    if (needsClient) await c.query('ROLLBACK')
    throw err
  } finally {
    if (needsClient) c.release()
  }
}

/**
 * Update a context entry's mutable fields. Scopes to work_item_id to prevent IDOR.
 * Sets is_edited=true and updated_at=now().
 *
 * @param {number}  entryId
 * @param {number}  workItemId  - must match the entry's work_item_id
 * @param {Object}  fields      - any subset of { content, title, tags, visibility }
 * @returns {Promise<Object|null>} updated row, or null if not found / wrong work item
 */
export async function updateContextEntry(entryId, workItemId, { content, title, tags, visibility }) {
  const sets = []
  const params = []

  if (content    !== undefined) { params.push(content);    sets.push(`content=$${params.length}`) }
  if (title      !== undefined) { params.push(title);      sets.push(`title=$${params.length}`) }
  if (tags       !== undefined) { params.push(tags);       sets.push(`tags=$${params.length}`) }
  if (visibility !== undefined) { params.push(visibility); sets.push(`visibility=$${params.length}`) }

  if (sets.length === 0) throw new Error('Nothing to update')

  sets.push('is_edited=true', 'updated_at=now()')
  params.push(entryId, workItemId)

  const r = await pool.query(
    `UPDATE runtime.context_entries SET ${sets.join(', ')} WHERE id=$${params.length - 1} AND work_item_id=$${params.length} RETURNING *`,
    params,
  )
  return r.rows[0] || null
}

/**
 * Delete a context entry by id. Scopes to work_item_id to prevent IDOR.
 *
 * @param {number}  entryId
 * @param {number}  workItemId  - must match the entry's work_item_id
 * @returns {Promise<Object|null>} the deleted row, or null if not found / wrong work item
 */
export async function deleteContextEntry(entryId, workItemId) {
  const r = await pool.query(
    `DELETE FROM runtime.context_entries WHERE id=$1 AND work_item_id=$2 RETURNING id, author_id`,
    [entryId, workItemId],
  )
  return r.rows[0] || null
}
