/**
 * runtime/attachments.js
 * CRUD for work item attachments. Emits work_item.attachment_added /
 * attachment_removed events inside the same transaction.
 */

import crypto from 'node:crypto'
import { pool } from '../db/postgres.js'
import { generateUri } from '../core/uri.js'
import { emitEvent, nudgeAfterCommit } from '../core/events.js'
import { getStorage, buildStorageKey } from '../core/storage/index.js'

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

export async function createFileAttachment({ workItemId, fileName, mimeType, buffer, userId }) {
  const storage = getStorage()
  const uuid = crypto.randomUUID()
  const storageKey = buildStorageKey(uuid)

  // Write bytes BEFORE the DB transaction so a failed write doesn't leave
  // a row pointing at missing data. If the DB tx then fails, we orphan
  // the file on disk — accept that for v1; a janitor task can sweep later.
  await storage.put(storageKey, buffer)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const uri = generateUri('system', 'attachments')
    const ins = await client.query(`
      INSERT INTO runtime.attachments
        (uri, work_item_id, kind, storage_key, file_name, file_size_bytes, mime_type, uploaded_by_user_id)
      VALUES ($1, $2, 'file', $3, $4, $5, $6, $7)
      RETURNING id, uri, work_item_id, kind, storage_key, file_name, file_size_bytes,
                mime_type, url, url_title, uploaded_by_user_id, uploaded_at
    `, [uri, workItemId, storageKey, fileName, buffer.length, mimeType || null, userId])
    const row = ins.rows[0]

    await emitEvent(client, {
      eventType: 'work_item.attachment_added',
      entityId: workItemId,
      actorId: userId,
      payload: {
        attachment_id: row.id,
        kind: 'file',
        file_name: fileName,
        file_size_bytes: buffer.length,
        mime_type: mimeType || null,
      },
    })
    await client.query('COMMIT')
    nudgeAfterCommit()
    return row
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    // Best effort: clean up the orphan file we just wrote.
    await storage.delete(storageKey).catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function createLinkAttachment({ workItemId, url, title, userId }) {
  const client = await pool.connect()
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

export async function deleteAttachment({ attachmentId, userId }) {
  const att = await getAttachment(attachmentId)
  if (!att) return { deleted: false, reason: 'not_found' }

  const storage = getStorage()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`DELETE FROM runtime.attachments WHERE id = $1`, [attachmentId])
    await emitEvent(client, {
      eventType: 'work_item.attachment_removed',
      entityId: att.work_item_id,
      actorId: userId,
      payload: {
        attachment_id: attachmentId,
        kind: att.kind,
        file_name: att.file_name || null,
        url: att.url || null,
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

  if (att.kind === 'file' && att.storage_key) {
    await storage.delete(att.storage_key).catch(() => {})
  }
  return { deleted: true, attachment: att }
}
