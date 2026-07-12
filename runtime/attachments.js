/**
 * runtime/attachments.js
 * CRUD for work item attachments. Emits work_item.attachment_added /
 * attachment_removed events inside the same transaction.
 */

import { pool, getClient } from '../db/postgres.js'
import { generateUri } from '../core/uri.js'
import { emitEvent, nudgeAfterCommit } from '../core/events.js'

export async function listAttachments(workItemId) {
  const r = await pool.query(`
    SELECT a.id, a.uri, a.work_item_id, a.kind,
           a.storage_key, a.file_name, a.file_size_bytes, a.mime_type,
           a.url, a.url_title,
           a.uploaded_by_user_id, a.uploaded_at,
           u.display_name AS uploaded_by_name
    FROM runtime.attachments a
    LEFT JOIN blueprint.users u ON u.id = a.uploaded_by_user_id
    WHERE a.work_item_id = $1
    ORDER BY a.uploaded_at DESC, a.id DESC
  `, [workItemId])
  return r.rows
}

export async function getAttachment(attachmentId) {
  const r = await pool.query(
    `SELECT * FROM runtime.attachments WHERE id = $1`,
    [attachmentId]
  )
  return r.rows[0] || null
}

export async function createLinkAttachment({ workItemId, url, title, userId }) {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const uri = generateUri('system', 'attachments')
    const ins = await client.query(`
      INSERT INTO runtime.attachments
        (uri, work_item_id, kind, url, url_title, uploaded_by_user_id)
      VALUES ($1, $2, 'link', $3, $4, $5)
      RETURNING id, uri, work_item_id, kind, storage_key, file_name, file_size_bytes,
                mime_type, url, url_title, uploaded_by_user_id, uploaded_at
    `, [uri, workItemId, url, title || null, userId])
    const row = ins.rows[0]

    await emitEvent(client, {
      eventType: 'work_item.attachment_added',
      entityId: workItemId,
      actorId: userId,
      payload: {
        attachment_id: row.id,
        kind: 'link',
        url,
        url_title: title || null,
      },
    })
    await client.query('COMMIT')
    nudgeAfterCommit()
    return row
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function deleteAttachment({ attachmentId, workItemId, userId, actorIsAdmin }) {
  const client = await getClient()
  let att = null
  try {
    await client.query('BEGIN')

    const lookup = await client.query(
      `SELECT * FROM runtime.attachments WHERE id = $1`,
      [attachmentId]
    )
    if (lookup.rowCount === 0) {
      await client.query('ROLLBACK')
      return { deleted: false, reason: 'not_found' }
    }
    att = lookup.rows[0]

    // Verify the attachment belongs to the URL-stated work item.
    if (workItemId != null && att.work_item_id !== workItemId) {
      await client.query('ROLLBACK')
      return { deleted: false, reason: 'not_found' }
    }

    const isUploader = att.uploaded_by_user_id === userId
    if (!isUploader && !actorIsAdmin) {
      await client.query('ROLLBACK')
      return { deleted: false, reason: 'forbidden', attachment: att }
    }

    const del = await client.query(
      `DELETE FROM runtime.attachments WHERE id = $1`,
      [attachmentId]
    )
    if (del.rowCount === 0) {
      // Lost a race; row was already deleted between SELECT and DELETE.
      await client.query('ROLLBACK')
      return { deleted: false, reason: 'not_found' }
    }

    await emitEvent(client, {
      eventType: 'work_item.attachment_removed',
      entityId: att.work_item_id,
      actorId: userId,
      payload: {
        attachment_id: attachmentId,
        kind: att.kind,
        file_name: att.file_name || null,
        url: att.url || null,
        url_title: att.url_title || null,
      },
    })
    await client.query('COMMIT')
    nudgeAfterCommit()
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }

  return { deleted: true, attachment: att }
}
