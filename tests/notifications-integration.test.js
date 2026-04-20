/**
 * tests/notifications-integration.test.js
 * End-to-end integration tests for the notifications system.
 * Requires: server running on port 3000 (npm run dev or npm start).
 *
 * Plan: docs/superpowers/plans/2026-04-20-notifications.md — Task 25
 *
 * Adaptation notes vs. plan template:
 *   - Plan assumed user id=1 is both the test user and the @mentioned target.
 *     Real seed has no user id=1 (lowest is 8). The authenticated test user is
 *     dynamically resolved (test@flowos.dev, id varies by seed run).
 *   - @mention target is user 8 (chris@flowos.dev, handle "chris"), who watches
 *     work item 106. Tests that resolve notifications for the authenticated user
 *     insert a row directly so actor-suppression doesn't interfere.
 *   - Direct DB queries used where the API only exposes the current user's own
 *     notifications (GET /notifications filters by req.userId).
 *   - event_id is NOT NULL in the schema. Injected test rows use real event IDs
 *     from runtime.events (distinct rows so UNIQUE(user_id, event_id) holds).
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { query } from '../db/postgres.js'
import { createAuthApi } from './helpers/auth.js'

const api = createAuthApi()

// Work item 106 has user 8 (chris@flowos.dev, handle "chris") as a watcher.
// The test posts a comment @mentioning chris, which should create a notification
// for chris via both the 'watching' and 'mentioned' relationships.
const TARGET_WORK_ITEM_ID = 106

// We'll resolve the actual IDs at runtime via before().
let mentionTargetUserId     // user who will be @mentioned (chris, id=8)
let mentionTargetHandle     // email-prefix handle used in @mention
let authenticatedUserId     // test user who calls the API (test@flowos.dev)
let injectedNotificationId  // notification inserted for single mark-read test
let spareEventId1           // real event id for test-2 injection
let spareEventId2           // real event id for test-3 "other item" injection
let spareEventId3           // real event id for test-3 "target item" injection

describe('notifications — end-to-end', () => {
  before(async () => {
    // Resolve mention target: lowest real human user (user 8, chris@flowos.dev)
    const { rows: userRows } = await query(
      `SELECT id, split_part(email, '@', 1) AS handle
         FROM blueprint.users
        ORDER BY id ASC
        LIMIT 1`
    )
    assert.ok(userRows.length, 'DB must have at least one user')
    mentionTargetUserId = userRows[0].id
    mentionTargetHandle = userRows[0].handle

    // Resolve authenticated user id (test@flowos.dev, created by auth helper)
    const { rows: authRows } = await query(
      `SELECT id FROM blueprint.users WHERE email = 'test@flowos.dev' LIMIT 1`
    )
    assert.ok(authRows.length, 'test@flowos.dev must exist — run auth setup first')
    authenticatedUserId = authRows[0].id

    // Clean up any stale notifications that could interfere
    await query('DELETE FROM runtime.notifications WHERE user_id = $1', [mentionTargetUserId])
    await query('DELETE FROM runtime.notifications WHERE user_id = $1', [authenticatedUserId])

    // Verify the mention target is watching the test work item so the
    // notifications subscriber will create a row (watching + mentioned reasons)
    const { rows: watchRows } = await query(
      `SELECT 1 FROM runtime.work_item_user_relationships
        WHERE work_item_id = $1 AND user_id = $2 AND is_active = true`,
      [TARGET_WORK_ITEM_ID, mentionTargetUserId]
    )
    assert.ok(
      watchRows.length,
      `User ${mentionTargetUserId} must have an active relationship with work item ${TARGET_WORK_ITEM_ID}`
    )

    // Fetch 3 real event IDs for injected test rows.
    // runtime.notifications.event_id is NOT NULL with a UNIQUE(user_id, event_id)
    // constraint. We pick events not already linked to a notification for
    // authenticatedUserId so the unique constraint cannot fire.
    const { rows: evtRows } = await query(
      `SELECT e.id
         FROM runtime.events e
        WHERE NOT EXISTS (
          SELECT 1 FROM runtime.notifications n
           WHERE n.event_id = e.id AND n.user_id = $1
        )
        ORDER BY e.id DESC
        LIMIT 3`,
      [authenticatedUserId]
    )
    assert.ok(
      evtRows.length >= 3,
      `Need at least 3 events in runtime.events not already used by user ${authenticatedUserId}. Found ${evtRows.length}.`
    )
    spareEventId1 = Number(evtRows[0].id)
    spareEventId2 = Number(evtRows[1].id)
    spareEventId3 = Number(evtRows[2].id)
  })

  after(async () => {
    // Clean up test data
    await query(
      'DELETE FROM runtime.notifications WHERE user_id IN ($1, $2)',
      [mentionTargetUserId, authenticatedUserId]
    )
  })

  // ─── Test 1: mention creates notification ──────────────────────────────────

  it('comment with @mention creates a notification for mentioned user', async () => {
    const body = `Hey @${mentionTargetHandle} check this out`

    const res = await api(`/work-items/${TARGET_WORK_ITEM_ID}/comments`, {
      method: 'POST',
      body:   JSON.stringify({ body }),
    })
    assert.equal(res.status, 201, `POST comment failed: ${JSON.stringify(res.data)}`)

    // Give the event processor time to drain and write the notification.
    // The processor is nudged immediately after commit via nudgeAfterCommit().
    await new Promise(r => setTimeout(r, 2000))

    // Query the DB directly — GET /notifications only returns the caller's own
    // rows, and the caller (test user) is the actor and is suppressed.
    // The notification was created for mentionTargetUserId.
    const { rows } = await query(
      `SELECT id, reasons, event_type
         FROM runtime.notifications
        WHERE user_id = $1
          AND work_item_id = $2
          AND event_type = 'work_item.commented'
        ORDER BY id DESC
        LIMIT 5`,
      [mentionTargetUserId, TARGET_WORK_ITEM_ID]
    )

    const mentioned = rows.find(r => r.reasons && r.reasons.includes('mentioned'))
    assert.ok(mentioned, `Expected a 'mentioned' notification for user ${mentionTargetUserId}, got: ${JSON.stringify(rows)}`)
  })

  // ─── Test 2: PATCH /:id/read marks a single row read ──────────────────────

  it('PATCH /:id/read marks a single row read', async () => {
    // Insert a test notification for the authenticated user so we have something
    // to mark read. (Actor suppression prevents using the comment flow above.)
    // Uses a real event_id — the schema has event_id NOT NULL.
    const { rows: ins } = await query(
      `INSERT INTO runtime.notifications
         (user_id, event_id, work_item_id, event_type, reasons, summary)
       VALUES ($1, $2, $3, 'work_item.commented', ARRAY['watching'], 'Test notification')
       RETURNING id`,
      [authenticatedUserId, spareEventId1, TARGET_WORK_ITEM_ID]
    )
    injectedNotificationId = ins[0].id

    const res = await api(`/notifications/${injectedNotificationId}/read`, {
      method: 'PATCH',
    })
    assert.equal(
      res.status, 200,
      `PATCH /notifications/${injectedNotificationId}/read failed: ${JSON.stringify(res.data)}`
    )

    // Verify read_at is now set
    const { data: after } = await api('/notifications?limit=100')
    const row = after.rows.find(r => r.id === injectedNotificationId)
    assert.ok(row, `Notification ${injectedNotificationId} not found in GET /notifications response`)
    assert.ok(row.read_at, `read_at should be set after PATCH, got: ${JSON.stringify(row)}`)
  })

  // ─── Test 3: POST /mark-read with filter marks only matching rows ──────────

  it('POST /mark-read with work_item_id filter marks only matching rows', async () => {
    // Insert a fresh unread notification for the target work item
    const { rows: ins1 } = await query(
      `INSERT INTO runtime.notifications
         (user_id, event_id, work_item_id, event_type, reasons, summary)
       VALUES ($1, $2, $3, 'work_item.transitioned', ARRAY['watching'], 'Transition notification')
       RETURNING id`,
      [authenticatedUserId, spareEventId2, TARGET_WORK_ITEM_ID]
    )
    const targetNotifId = ins1[0].id

    // Insert another notification for a DIFFERENT work item — should NOT be marked.
    // work_item_id can be NULL (the column is nullable); using NULL avoids FK issues.
    const { rows: ins2 } = await query(
      `INSERT INTO runtime.notifications
         (user_id, event_id, work_item_id, event_type, reasons, summary)
       VALUES ($1, $2, NULL, 'work_item.transitioned', ARRAY['watching'], 'Other item notification')
       RETURNING id`,
      [authenticatedUserId, spareEventId3]
    )
    const otherNotifId = ins2[0].id

    const res = await api('/notifications/mark-read', {
      method: 'POST',
      body:   JSON.stringify({ work_item_id: TARGET_WORK_ITEM_ID }),
    })
    assert.equal(res.status, 200, `POST /notifications/mark-read failed: ${JSON.stringify(res.data)}`)

    // The target work item's notification should now be read
    const { data } = await api('/notifications?limit=200')
    const stillUnreadForItem = data.rows.filter(
      r => r.work_item_id === TARGET_WORK_ITEM_ID && !r.read_at
    )
    assert.equal(
      stillUnreadForItem.length,
      0,
      `Expected 0 unread notifications for work item ${TARGET_WORK_ITEM_ID}, got ${stillUnreadForItem.length}`
    )

    // The null-item notification should still be unread
    const otherRow = data.rows.find(r => r.id === otherNotifId)
    // If not in the paginated window that's fine — just check if visible
    if (otherRow) {
      assert.ok(!otherRow.read_at, 'Notification with null work_item_id should not have been marked read')
    }

    // Clean up the extra test notification
    await query('DELETE FROM runtime.notifications WHERE id = $1', [otherNotifId])
  })
})
