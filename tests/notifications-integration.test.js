/**
 * tests/notifications-integration.test.js
 * End-to-end integration tests for the notifications system.
 * Requires: server running on port 3000 (npm run dev or npm start).
 *
 * Plan: docs/superpowers/plans/2026-04-20-notifications.md — Task 25
 *
 * Adaptation notes vs. plan template:
 *   - Every fixture is provisioned by this file: an ephemeral org, the work item
 *     under test, the @mention target, and that target's watch relationship. The
 *     authenticated caller is the shared test user (test@flowos.dev), resolved by
 *     email since its id varies by seed run.
 *   - Tests that resolve notifications for the authenticated user insert a row
 *     directly so actor-suppression doesn't interfere.
 *   - Direct DB queries used where the API only exposes the current user's own
 *     notifications (GET /notifications filters by req.userId).
 *   - event_id is NOT NULL in the schema. Injected test rows use real event IDs
 *     from runtime.events (distinct rows so UNIQUE(user_id, event_id) holds);
 *     the events are generated here by PATCHing the item, not assumed present.
 */

import { describe, it, before, after } from 'node:test'
import { closePool } from './helpers/poolTeardown.js'
import assert from 'node:assert/strict'
import { query } from '../db/postgres.js'
import { createAuthApi } from './helpers/auth.js'
import { createTestOrg } from './helpers/testOrg.js'
import { createTestUser } from './helpers/testUser.js'

const api = createAuthApi()

// This suite used to target work item 106 and user 8 (chris@flowos.dev) and
// relied on a watcher relationship and ≥3 events already existing — all
// dogfood-only ambient state, so the file could not run on a fresh or CI
// database (DEBT.26841). It now provisions the item, the mention target, the
// watch relationship, and the events it needs.
let testOrg
let targetWorkItemId
let mentionTarget           // ephemeral user handle object
let mentionTargetUserId     // user who will be @mentioned
let mentionTargetHandle     // email-prefix handle used in @mention
let authenticatedUserId     // test user who calls the API (test@flowos.dev)
let injectedNotificationId  // notification inserted for single mark-read test
let spareEventId1           // real event id for test-2 injection
let spareEventId2           // real event id for test-3 "other item" injection
let spareEventId3           // real event id for test-3 "target item" injection

describe('notifications — end-to-end', () => {
  before(async () => {
    testOrg = await createTestOrg()

    // Mention target: an ephemeral user. The handle is the email prefix, which
    // MENTION_RE (/@([A-Za-z0-9_.-]+)/) matches — the helper's UUID-suffixed
    // local part is letters, digits and hyphens only.
    mentionTarget       = await createTestUser({ orgId: testOrg.orgId })
    mentionTargetUserId = mentionTarget.id
    mentionTargetHandle = mentionTarget.email.split('@')[0]

    // Resolve authenticated user id (test@flowos.dev, created by auth helper)
    const { rows: authRows } = await query(
      `SELECT id FROM blueprint.users WHERE email = 'test@flowos.dev' LIMIT 1`
    )
    assert.ok(authRows.length, 'test@flowos.dev must exist — run auth setup first')
    authenticatedUserId = authRows[0].id

    // The work item under test, owned by this file.
    const { status, data } = await api('/work-items', {
      method: 'POST',
      body: JSON.stringify({
        title:             'notifications integration item ' + Date.now(),
        work_item_type_id: testOrg.typeId,
        owner_org_id:      testOrg.orgId,
      }),
    })
    assert.equal(status, 201, `work item creation failed: ${JSON.stringify(data)}`)
    targetWorkItemId = data.id

    // Clean up any stale notifications that could interfere
    await query('DELETE FROM runtime.notifications WHERE user_id = $1', [mentionTargetUserId])
    await query('DELETE FROM runtime.notifications WHERE user_id = $1', [authenticatedUserId])

    // The mention target must watch the item so the notifications subscriber
    // creates a row with both 'watching' and 'mentioned' reasons.
    const { status: relStatus } = await api(`/work-items/${targetWorkItemId}/relationships`, {
      method: 'POST',
      body: JSON.stringify({ user_id: mentionTargetUserId, relationship_type: 'watching' }),
    })
    assert.equal(relStatus, 201, 'failed to make the mention target a watcher')

    // Three spare event IDs for injected notification rows.
    // runtime.notifications.event_id is NOT NULL with UNIQUE(user_id, event_id),
    // so pick events not already linked to a notification for authenticatedUserId.
    // Generate our own rather than assuming the DB already holds enough: each
    // PATCH below emits a work_item.edited event.
    for (let i = 0; i < 3; i++) {
      const { status: patchStatus } = await api(`/work-items/${targetWorkItemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: `notifications integration item seed-event ${i}` }),
      })
      assert.equal(patchStatus, 200, 'failed to generate a spare event')
    }
    await new Promise(r => setTimeout(r, 300))

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
    await testOrg?.teardown()
    await mentionTarget?.teardown()
  })

  // ─── Test 1: mention creates notification ──────────────────────────────────

  it('comment with @mention creates a notification for mentioned user', async () => {
    const body = `Hey @${mentionTargetHandle} check this out`

    const res = await api(`/work-items/${targetWorkItemId}/comments`, {
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
      [mentionTargetUserId, targetWorkItemId]
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
      [authenticatedUserId, spareEventId1, targetWorkItemId]
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
      [authenticatedUserId, spareEventId2, targetWorkItemId]
    )
    const _targetNotifId = ins1[0].id

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
      body:   JSON.stringify({ work_item_id: targetWorkItemId }),
    })
    assert.equal(res.status, 200, `POST /notifications/mark-read failed: ${JSON.stringify(res.data)}`)

    // The target work item's notification should now be read
    const { data } = await api('/notifications?limit=200')
    const stillUnreadForItem = data.rows.filter(
      r => r.work_item_id === targetWorkItemId && !r.read_at
    )
    assert.equal(
      stillUnreadForItem.length,
      0,
      `Expected 0 unread notifications for work item ${targetWorkItemId}, got ${stillUnreadForItem.length}`
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

// Close the shared PG pool so this test process can exit cleanly (DEBT.26643).
after(closePool)
