/**
 * runtime/transitions.js
 * Stage transition engine — the heart of Gladius.
 *
 * Two-phase approach:
 *   Phase 1: prepareTransition()  — validate, evaluate criteria, collect prompts
 *   Phase 2: executeTransition()  — commit the transition, run actions
 *
 * Design decisions locked:
 *   - API criteria failures BLOCK the transition
 *   - Optional spawn prompts shown BEFORE transition fires
 *   - Spawn action failures ROLL BACK the entire transition
 *   - api_call actions are fire-and-forget AFTER the transaction commits
 *
 * Usage:
 *   import { prepareTransition, executeTransition } from '../runtime/transitions.js'
 *
 *   // Phase 1
 *   const prep = await prepareTransition(workItemId, toStageId, userId)
 *   if (!prep.canTransition) return { blocked: true, reasons: prep.blockedCriteria }
 *   // Show prep.optionalSpawns to user, collect decisions
 *
 *   // Phase 2
 *   const result = await executeTransition(workItemId, toStageId, userId, {
 *     reason: 'Approved by stakeholder',
 *     spawnDecisions: { 42: true, 43: false }  // action_id → accepted
 *   })
 */

import { query, getClient }        from '../db/postgres.js'
import { emitEvent, nudgeAfterCommit } from '../core/events.js'
import { evaluateExitCriteria, populateExitCriteriaStatus } from './exitCriteria.js'
import { resolveOrgCalendar, calculateWorkingTime } from '../core/calendar.js'
import { executePlaybookForStageEntry } from './playbookExecutor.js'
import { checkContextStaleness }        from './stalenessDetector.js'

// =============================================================================
// PHASE 1 — PREPARE
// =============================================================================

/**
 * Validate a transition and evaluate all gates before committing anything.
 * Safe to call multiple times — no state changes.
 *
 * @param {number} workItemId - runtime.work_items.id
 * @param {number} toStageId  - blueprint.stages.id (destination)
 * @param {number} userId     - blueprint.users.id (requesting user)
 * @returns {Promise<Object>} Preparation result
 */
export async function prepareTransition(workItemId, toStageId, userId) {
  // Load work item
  const workItem = await loadWorkItem(workItemId)
  if (!workItem) {
    return error('Work item not found')
  }
  if (workItem.spawn_state === 'done' || workItem.spawn_state === 'cancelled') {
    return error(`Work item is already ${workItem.spawn_state}`)
  }

  // Load the transition definition
  const transition = await loadTransition(workItem.current_stage_id, toStageId)
  if (!transition) {
    return error(`No transition exists from "${workItem.current_stage_name}" to the target stage`)
  }
  if (!transition.is_active) {
    return error('This transition is not currently active')
  }

  // Check role restrictions
  const roleCheck = await checkRoleRestrictions(transition.id, userId)
  if (!roleCheck.allowed) {
    return error(`Your role does not allow this transition. Required: ${roleCheck.requiredRoles.join(', ')}`)
  }

  // Check reason required
  if (transition.requires_reason) {
    // Caller must provide reason in executeTransition — flag it here
  }

  // Evaluate exit criteria on the current stage
  const criteriaResult = await evaluateExitCriteria(workItemId, workItem.current_stage_id)

  // Collect optional spawn prompts
  const optionalSpawns = await loadOptionalSpawnActions(transition.id)

  // Load required spawn and api_call actions for transparency
  const requiredActions = await loadRequiredActions(transition.id)

  if (!criteriaResult.passed) {
    return {
      canTransition:   false,
      blockedCriteria: criteriaResult.failed,
      warnings:        criteriaResult.warnings,
      allCriteria:     criteriaResult.all,
      optionalSpawns,
      requiredActions,
      workItem,
      transition,
      requiresReason:  transition.requires_reason,
    }
  }

  return {
    canTransition:    true,
    blockedCriteria:  [],
    warnings:         criteriaResult.warnings,
    allCriteria:      criteriaResult.all,
    optionalSpawns,   // Show these to user before executing
    requiredActions,  // Informational — these will fire automatically
    workItem,
    transition,
    requiresReason:   transition.requires_reason,
  }
}

// =============================================================================
// PHASE 2 — EXECUTE
// =============================================================================

/**
 * Execute a stage transition. Commits all state changes atomically.
 *
 * @param {number} workItemId
 * @param {number} toStageId
 * @param {number} userId
 * @param {Object} options
 * @param {string}  options.reason         - Required if transition.requires_reason
 * @param {Object}  options.spawnDecisions - { [actionId]: boolean } for optional spawns
 * @returns {Promise<Object>} Execution result
 */
export async function executeTransition(workItemId, toStageId, userId, options = {}) {
  const { reason, spawnDecisions = {} } = options

  // Re-validate (state may have changed since prepare)
  const prep = await prepareTransition(workItemId, toStageId, userId)
  if (!prep.canTransition) {
    return { success: false, error: 'Transition no longer valid', details: prep }
  }

  const { workItem, transition } = prep

  // Validate reason provided if required
  if (transition.requires_reason && !reason?.trim()) {
    return { success: false, error: 'A reason is required for this transition' }
  }

  // Load destination stage
  const toStage = await loadStage(toStageId)
  if (!toStage) {
    return { success: false, error: 'Destination stage not found' }
  }

  // Load all transition actions
  const actions = await loadAllTransitionActions(transition.id)

  // Separate spawn actions from api_call actions
  const spawnActions   = actions.filter(a => a.action_type === 'spawn')
  const optSpawnActions= actions.filter(a => a.action_type === 'optional_spawn'
                                          && spawnDecisions[a.id] === true)
  const apiCallActions = actions.filter(a => a.action_type === 'api_call')
  const allSpawns      = [...spawnActions, ...optSpawnActions]

  // Get org calendar for working time calculation
  const calendar = await resolveOrgCalendar(workItem.owner_org_id)
  const now       = new Date()

  // =========================================================================
  // POSTGRESQL TRANSACTION
  // Everything in here succeeds or everything rolls back.
  // =========================================================================
  const client = await getClient()
  let transitionHistoryId
  let spawnedWorkItems = []

  try {
    await client.query('BEGIN')

    // 1. Update work item's current stage
    // Substate is a single active|blocked flag (FEAT.25491 cut the 'waiting' value);
    // entering a stage always lands 'active' — blocked is set explicitly via the substate endpoint.
    const newSubstate = 'active'
    const fromStageClass = workItem.current_stage_class

    // Determine lifecycle timestamps
    // started_at: set on first transition out of intake/triage/queued into a working stage
    const isLeavingQueue = ['intake', 'triage', 'queued'].includes(fromStageClass)
    const isEnteringWork = !['intake', 'triage', 'queued', 'done', 'cancelled'].includes(toStage.stage_class)
    const setStartedAt = isLeavingQueue && isEnteringWork && !workItem.started_at

    // resolved_at: set when entering a terminal stage, cleared if moving back out
    const setResolvedAt = toStage.is_terminal ? now : null
    const clearResolvedAt = !toStage.is_terminal && workItem.resolved_at

    let updateSql = `
      UPDATE runtime.work_items SET
        current_stage_id        = $1,
        current_substate        = $2,
        entered_current_stage_at = $3,
        spawn_state             = $4,
        updated_at              = $3`
    const updateVals = [
      toStageId,
      newSubstate,
      now,
      toStage.is_terminal ? (toStage.stage_class === 'cancelled' ? 'cancelled' : 'done') : 'active',
    ]

    if (setStartedAt) {
      updateVals.push(now)
      updateSql += `,\n        started_at = $${updateVals.length}`
    }
    if (setResolvedAt) {
      updateVals.push(setResolvedAt)
      updateSql += `,\n        resolved_at = $${updateVals.length}`
    } else if (clearResolvedAt) {
      updateSql += `,\n        resolved_at = NULL`
    }

    // Cancellation disposition: entering a cancelled-class stage records who
    // cancelled it, why, and when. `now` ($3) is forward-generated like
    // resolved_at — a legitimate event timestamp, not a back-fill. Part of the
    // core transition UPDATE (not a side effect) so it commits atomically.
    if (toStage.stage_class === 'cancelled') {
      updateSql += `,\n        cancelled_at = $3`
      updateVals.push(userId)
      updateSql += `,\n        cancelled_by_user_id = $${updateVals.length}`
      updateVals.push(reason ?? null)
      updateSql += `,\n        cancelled_reason = $${updateVals.length}`
    }

    updateVals.push(workItemId)
    updateSql += `\n      WHERE id = $${updateVals.length}`

    await client.query(updateSql, updateVals)

    // 2. Populate exit criteria status rows for the new stage
    await populateExitCriteriaStatus(client, workItemId, toStageId)

    // 3. Record transition history
    const workingTime = calculateWorkingTime(
      workItem.entered_current_stage_at,
      now,
      calendar
    )

    const historyResult = await client.query(`
      INSERT INTO runtime.stage_transition_history (
        work_item_id, from_stage_id, to_stage_id, stage_transition_id,
        entered_from_stage_at, exited_from_stage_at,
        working_time_in_stage_seconds, calendar_id,
        transitioned_by_user_id, transition_reason, was_automated
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING id
    `, [
      workItemId,
      workItem.current_stage_id,
      toStageId,
      transition.id,
      workItem.entered_current_stage_at,
      now,
      workingTime,
      calendar?.id ?? null,
      userId,
      reason ?? null,
      false,
    ])
    transitionHistoryId = historyResult.rows[0].id

    // 4. Execute spawn actions (fatal if any fail — rolls back entire transaction)
    for (const action of allSpawns) {
      const spawned = await executeSpawnAction(client, action, workItem, transitionHistoryId, now)
      spawnedWorkItems.push(spawned)
    }

    // 5. Emit the transition event (in-tx — rolls back with the transition)
    await emitEvent(client, {
      eventType: 'work_item.transitioned',
      entityId:  workItemId,
      entityUri: workItem.uri,
      actorId:   userId,
      payload: {
        from_stage_id:          workItem.current_stage_id,
        to_stage_id:            toStageId,
        to_stage_uri:           toStage.uri,
        to_stage_name:          toStage.name,
        to_stage_class:         toStage.stage_class,
        transition_history_id:  transitionHistoryId,
        working_time_seconds:   workingTime,
        reason:                 reason ?? null,
        initial_substate:       newSubstate,
      },
    })

    await client.query('COMMIT')

  } catch (err) {
    await client.query('ROLLBACK')
    console.error('[transitions] Transaction rolled back:', err.message)
    return {
      success: false,
      error:   `Transition failed and was rolled back: ${err.message}`,
    }
  } finally {
    client.release()
  }

  // =========================================================================
  // POST-TRANSACTION — fire and forget, never rolls back the transition
  // =========================================================================

  // Nudge the event processor so subscribers (search-index, audit-log, notifications) drain now
  nudgeAfterCommit()

  // Fire playbook executor — non-blocking side effect, never rolls back the transition
  executePlaybookForStageEntry(workItemId, toStageId, workItem.owner_org_id, workItem.work_item_type_id)
    .catch(() => {})

  // Fire staleness detector when entering an in-progress stage — non-blocking
  if (toStage.stage_class === 'in-progress') {
    checkContextStaleness(workItemId, workItem.owner_org_id)
      .catch(err => console.error(`[stalenessDetector] Error for work item ${workItemId}:`, err.message))
  }

  // Fire api_call actions — truly fire and forget.
  // Each action logs its own runtime.transition_action_log row AND emits
  // transition_action.api_call_fired after the call completes.
  for (const action of apiCallActions) {
    fireApiCallAction(action, workItem, transitionHistoryId)
      .catch(err => console.error(`[transitions] api_call action ${action.id} failed:`, err.message))
  }

  return {
    success: true,
    workItemId,
    fromStageId:      workItem.current_stage_id,
    toStageId,
    transitionHistoryId,
    spawnedWorkItems,
    warnings:         prep.warnings,
  }
}

// =============================================================================
// ACTION EXECUTORS
// =============================================================================

/**
 * Execute a spawn action inside the open transaction.
 * Fatal on failure — caller catches and rolls back.
 *
 * @param {pg.PoolClient} client
 * @param {Object}        action     - transition_actions row
 * @param {Object}        workItem   - source work item
 * @param {number}        historyId  - stage_transition_history.id
 * @param {Date}          now
 * @returns {Promise<Object>} The created work item row
 */
async function executeSpawnAction(client, action, workItem, historyId, now) {
  if (!action.spawn_work_item_type_id) {
    throw new Error(`Spawn action ${action.id} has no work_item_type_id configured`)
  }

  // Resolve target org — default to same org as source
  const targetOrgId = action.spawn_target_org_id || workItem.owner_org_id

  // Verify target org exists
  const orgResult = await client.query(
    'SELECT id, uri, slug FROM blueprint.organizations WHERE id = $1 AND is_active = true',
    [targetOrgId]
  )
  if (!orgResult.rows.length) {
    throw new Error(`Spawn target org ${targetOrgId} not found or inactive`)
  }
  const targetOrg = orgResult.rows[0]

  // Find the entry stage for the work item type's workflow
  const stageResult = await client.query(`
    SELECT s.id, s.uri, s.name, s.stage_class
    FROM blueprint.stages s
    JOIN blueprint.work_item_type_workflows witw ON witw.workflow_id = s.workflow_id
    WHERE witw.work_item_type_id = $1
      AND witw.is_current = true
      AND s.is_entry_stage = true
      AND s.is_active = true
    LIMIT 1
  `, [action.spawn_work_item_type_id])

  if (!stageResult.rows.length) {
    throw new Error(`No entry stage found for work item type ${action.spawn_work_item_type_id}`)
  }
  const entryStage = stageResult.rows[0]

  // Map fields from source work item to spawned item
  const fieldMapping   = action.spawn_field_mapping || []
  const sourceFields   = workItem.field_values || {}
  const spawnedFields  = {}

  for (const mapping of fieldMapping) {
    const sourceVal = workItem[mapping.source_field] ?? sourceFields[mapping.source_field]
    if (sourceVal !== undefined) {
      spawnedFields[mapping.target_field] = sourceVal
    }
  }

  // Generate URI for spawned work item
  const { generateUri } = await import('../core/uri.js')
  const spawnedUri = generateUri(targetOrg.slug, 'work-items')

  // Create the spawned work item
  const spawnResult = await client.query(`
    INSERT INTO runtime.work_items (
      uri, work_item_type_id, owner_org_id,
      current_stage_id, current_substate,
      service_class_id, spawn_state,
      parent_id, origin_work_item_id,
      title, field_values,
      entered_current_stage_at, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,'active',$5,'active',$6,$7,$8,$9,$10,$10,$10)
    RETURNING *
  `, [
    spawnedUri,
    action.spawn_work_item_type_id,
    targetOrgId,
    entryStage.id,
    null,              // service_class_id — class-of-service vocabulary cut (FEAT.25491); column retained, unwritten
    null,              // parent_id — spawned items are not children, they're independent
    workItem.id,       // origin_work_item_id — tracks where this came from
    `${workItem.title} (spawned)`,
    JSON.stringify(spawnedFields),
    now,
  ])

  const spawned = spawnResult.rows[0]
  spawned.owner_org_uri     = targetOrg.uri
  spawned.owner_org_slug    = targetOrg.slug
  spawned.current_stage_uri = entryStage.uri
  spawned.current_stage_name= entryStage.name
  spawned.current_stage_class = entryStage.stage_class

  // Log the spawn action
  await client.query(`
    INSERT INTO runtime.transition_action_log (
      stage_transition_history_id, action_type,
      executed_at, was_accepted, spawned_work_item_id
    ) VALUES ($1, 'spawn', $2, true, $3)
  `, [historyId, now, spawned.id])

  // Emit spawn fired event (for subscribers: audit-log, notifications)
  await emitEvent(client, {
    eventType: 'transition_action.spawn_fired',
    entityId:  workItem.id,
    entityUri: workItem.uri,
    actorId:   null,     // spawns are system-initiated within a transition
    payload: {
      transition_action_id: action.id,
      stage_transition_history_id: historyId,
      spawned_work_item_id: spawned.id,
      spawned_uri:          spawned.uri,
      spawned_type_id:      action.spawn_work_item_type_id,
      spawned:              spawned,
    },
  })

  // Emit work_item.created for the spawned item so subscribers (search-index, audit-log) pick it up
  await emitEvent(client, {
    eventType: 'work_item.created',
    entityId:  spawned.id,
    entityUri: spawned.uri,
    actorId:   null,
    payload: {
      title:               spawned.title,
      work_item_type_uri:  null,
      owner_org_uri:       spawned.owner_org_uri,
      owner_org_slug:      spawned.owner_org_slug,
      current_stage_uri:   spawned.current_stage_uri,
      current_stage_name:  spawned.current_stage_name,
      current_stage_class: spawned.current_stage_class,
      current_substate:    'active',
      spawn_state:         spawned.spawn_state,
      sla_status:          'no_sla',
      due_date:            null,
      created_at:          spawned.created_at,
      updated_at:          spawned.updated_at,
    },
  })

  return spawned
}

/**
 * Fire an api_call action — truly fire and forget.
 * Logs result but never affects the transition.
 *
 * @param {Object} action
 * @param {Object} workItem
 * @param {number} historyId
 */
async function fireApiCallAction(action, workItem, historyId) {
  const payload = interpolateTemplate(action.api_payload_template, workItem)
  const startedAt = new Date()
  let responseCode = null
  let responseBody = null
  let failed = false
  let failureReason = null

  try {
    const response = await fetch(action.api_endpoint, {
      method:  action.api_method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(action.api_headers || {}),
      },
      body: JSON.stringify(payload),
    })
    responseCode = response.status
    responseBody = await response.json().catch(() => null)
    failed = !response.ok
    if (failed) failureReason = `HTTP ${responseCode}`
  } catch (err) {
    failed = true
    failureReason = err.message
  }

  // Log the result — best effort, don't throw
  await query(`
    INSERT INTO runtime.transition_action_log (
      stage_transition_history_id, action_type,
      executed_at, api_endpoint, api_response_code,
      api_response_body, api_failed, api_failure_reason
    ) VALUES ($1, 'api_call', $2, $3, $4, $5, $6, $7)
  `, [
    historyId, startedAt,
    action.api_endpoint, responseCode,
    responseBody ? JSON.stringify(responseBody) : null,
    failed, failureReason,
  ]).catch(err => console.error('[transitions] Failed to log api_call result:', err.message))

  // Emit event — post-transaction, so use a short-lived tx of its own.
  const client = await getClient()
  try {
    await client.query('BEGIN')
    await emitEvent(client, {
      eventType: 'transition_action.api_call_fired',
      entityId:  workItem.id,
      entityUri: workItem.uri,
      actorId:   null,
      payload: {
        transition_action_id:        action.id,
        stage_transition_history_id: historyId,
        endpoint:                    action.api_endpoint,
        method:                      action.api_method || 'POST',
        response_code:               responseCode,
        failed,
        failure_reason:              failureReason,
        started_at:                  startedAt.toISOString(),
      },
    })
    await client.query('COMMIT')
    nudgeAfterCommit()
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('[transitions] Failed to emit api_call_fired event:', err.message)
  } finally {
    client.release()
  }
}

// =============================================================================
// DATA LOADERS
// =============================================================================

async function loadWorkItem(workItemId) {
  const result = await query(`
    SELECT wi.*,
      s.name       AS current_stage_name,
      s.stage_class AS current_stage_class,
      s.is_terminal AS current_stage_is_terminal,
      o.uri        AS org_uri,
      o.slug       AS org_slug
    FROM runtime.work_items wi
    JOIN blueprint.stages s ON s.id = wi.current_stage_id
    JOIN blueprint.organizations o ON o.id = wi.owner_org_id
    WHERE wi.id = $1
  `, [workItemId])
  return result.rows[0] || null
}

async function loadTransition(fromStageId, toStageId) {
  const result = await query(`
    SELECT * FROM blueprint.stage_transitions
    WHERE from_stage_id = $1 AND to_stage_id = $2
  `, [fromStageId, toStageId])
  return result.rows[0] || null
}

async function loadStage(stageId) {
  const result = await query(
    'SELECT * FROM blueprint.stages WHERE id = $1',
    [stageId]
  )
  return result.rows[0] || null
}

async function checkRoleRestrictions(transitionId, userId) {
  // Check if any role restrictions exist for this transition
  const restrictionsResult = await query(`
    SELECT r.name FROM blueprint.stage_transition_role_restrictions str
    JOIN blueprint.roles r ON r.id = str.role_id
    WHERE str.stage_transition_id = $1
  `, [transitionId])

  if (!restrictionsResult.rows.length) {
    return { allowed: true }  // No restrictions — anyone can execute
  }

  const requiredRoles = restrictionsResult.rows.map(r => r.name)

  // Check if user has any of the required roles
  const userRoleResult = await query(`
    SELECT r.name FROM blueprint.org_memberships om
    JOIN blueprint.roles r ON r.id = om.role_id
    WHERE om.user_id = $1 AND om.is_active = true
      AND r.name = ANY($2)
  `, [userId, requiredRoles])

  return {
    allowed:       userRoleResult.rows.length > 0,
    requiredRoles,
  }
}

async function loadOptionalSpawnActions(transitionId) {
  const result = await query(`
    SELECT id, name, optional_spawn_prompt, optional_spawn_default,
           spawn_work_item_type_id, spawn_target_org_id
    FROM blueprint.transition_actions
    WHERE stage_transition_id = $1
      AND action_type = 'optional_spawn'
      AND is_active = true
    ORDER BY display_order ASC
  `, [transitionId])
  return result.rows
}

async function loadRequiredActions(transitionId) {
  const result = await query(`
    SELECT id, name, action_type, execution_timing
    FROM blueprint.transition_actions
    WHERE stage_transition_id = $1
      AND action_type IN ('spawn', 'api_call')
      AND is_active = true
    ORDER BY display_order ASC
  `, [transitionId])
  return result.rows
}

async function loadAllTransitionActions(transitionId) {
  const result = await query(`
    SELECT * FROM blueprint.transition_actions
    WHERE stage_transition_id = $1
      AND is_active = true
    ORDER BY display_order ASC
  `, [transitionId])
  return result.rows
}

// =============================================================================
// HELPERS
// =============================================================================

function error(message) {
  return { canTransition: false, error: message, blockedCriteria: [], warnings: [] }
}

function interpolateTemplate(template, workItem) {
  if (!template) return {}
  const fieldValues = workItem.field_values || {}
  const str = JSON.stringify(template)
  const interpolated = str.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return workItem[key] ?? fieldValues[key] ?? ''
  })
  try {
    return JSON.parse(interpolated)
  } catch {
    return template
  }
}

export default { prepareTransition, executeTransition }
