/**
 * runtime/subscribers/searchIndex.js
 * Maintains runtime.work_item_search. Idempotent UPSERT.
 *
 * Comments are sourced from runtime.work_item_comments.
 */

import { query } from '../../db/postgres.js'

const HANDLED = new Set([
  'work_item.created',
  'work_item.edited',
  'work_item.commented',
  'work_item.comment_edited',
  'work_item.comment_deleted',
])

export function handlesEventType(eventType) {
  return HANDLED.has(eventType)
}

export async function searchIndexHandler(event) {
  const workItemId = event.entity_id
  if (!workItemId) return

  const wiRes = await query(`
    SELECT id, title, description, field_values
    FROM runtime.work_items
    WHERE id = $1
  `, [workItemId])
  if (wiRes.rowCount === 0) {
    await query('DELETE FROM runtime.work_item_search WHERE work_item_id = $1', [workItemId])
    return
  }
  const wi = wiRes.rows[0]

  let customText = ''
  if (wi.field_values && typeof wi.field_values === 'object') {
    const textKeysRes = await query(`
      SELECT field_key FROM (
        SELECT field_key, field_type FROM blueprint.work_item_class_fields
        UNION ALL
        SELECT field_key, field_type FROM blueprint.work_item_type_fields
      ) f
      WHERE field_type IN ('text', 'textarea', 'url')
    `)
    const textKeys = new Set(textKeysRes.rows.map(r => r.field_key))
    for (const [k, v] of Object.entries(wi.field_values)) {
      if (textKeys.has(k) && typeof v === 'string' && v) {
        customText += ' ' + v
      }
    }
  }

  const commentsRes = await query(`
    SELECT body FROM runtime.work_item_comments WHERE work_item_id = $1 ORDER BY id
  `, [workItemId])
  const commentsText = commentsRes.rows.map(r => r.body).join(' ')

  const titleText = wi.title || ''
  const descriptionText = wi.description || ''

  await query(`
    INSERT INTO runtime.work_item_search
      (work_item_id, search_doc, title_text, description_text, custom_text, comments_text, refreshed_at)
    VALUES (
      $1,
      setweight(to_tsvector('english', $2), 'A') ||
      setweight(to_tsvector('english', $3), 'B') ||
      setweight(to_tsvector('english', $4), 'C') ||
      setweight(to_tsvector('english', $5), 'D'),
      $2, $3, $4, $5, NOW()
    )
    ON CONFLICT (work_item_id) DO UPDATE SET
      search_doc = EXCLUDED.search_doc,
      title_text = EXCLUDED.title_text,
      description_text = EXCLUDED.description_text,
      custom_text = EXCLUDED.custom_text,
      comments_text = EXCLUDED.comments_text,
      refreshed_at = NOW()
  `, [workItemId, titleText, descriptionText, customText.trim(), commentsText])
}
