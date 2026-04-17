/**
 * runtime/exitCriteria.js
 * Evaluates exit criteria for a stage before allowing a transition.
 *
 * Three tiers:
 *   manual   — human must have explicitly checked this off
 *   codified — system evaluates a condition against runtime state
 *   api      — external endpoint called, response evaluated
 *
 * API failures BLOCK the transition (treat as criteria not met).
 * Non-blocking criteria (is_blocking: false) warn but don't stop the transition.
 *
 * Usage:
 *   import { evaluateExitCriteria } from '../runtime/exitCriteria.js'
 *
 *   const result = await evaluateExitCriteria(workItemId, stageId)
 *   if (!result.passed) {
 *     return { blocked: true, reasons: result.failed }
 *   }
 */

import { query, getClient } from '../db/postgres.js'
import { emitEvent, nudgeAfterCommit } from '../core/events.js'

/**
 * Evaluate all exit criteria for a stage against a work item's current state.
 *
 * @param {number} workItemId - runtime.work_items.id
 * @param {number} stageId    - blueprint.stages.id (the stage being exited)
 * @returns {Promise<Object>} { passed, failed, warnings }
 */
export async function evaluateExitCriteria(workItemId, stageId) {
  // Load all active criteria for this stage
  const criteriaResult = await query(`
    SELECT * FROM blueprint.exit_criteria
    WHERE stage_id = $1 AND is_active = true
    ORDER BY display_order ASC
  `, [stageId])

  const criteria = criteriaResult.rows
  if (!criteria.length) return { passed: true, failed: [], warnings: [], all: [] }

  // Load the work item with its field values
  const workItemResult = await query(`
    SELECT wi.*, o.uri AS org_uri, o.slug AS org_slug
    FROM runtime.work_items wi
    JOIN blueprint.organizations o ON o.id = wi.owner_org_id
    WHERE wi.id = $1
  `, [workItemId])
  const workItem = workItemResult.rows[0]

  const failed   = []
  const warnings = []
  const all      = []

  for (const criterion of criteria) {
    const result = await evaluateSingleCriterion(criterion, workItem)

    const entry = {
      id:          criterion.id,
      name:        criterion.name,
      tier:        criterion.criteria_tier,
      description: criterion.description,
      is_blocking: criterion.is_blocking,
      passed:      result.passed,
      reason:      result.reason || null,
    }
    all.push(entry)

    // Update runtime status row (upsert — create if missing)
    const newStatus = result.passed ? 'met' : (criterion.criteria_tier === 'manual' ? 'pending' : 'failed')
    await upsertCriteriaStatus(workItemId, criterion, newStatus, result)

    if (!result.passed) {
      if (criterion.is_blocking) {
        failed.push({ ...entry })
      } else {
        warnings.push({ ...entry })
      }
    }
  }

  return {
    passed:   failed.length === 0,
    failed,
    warnings,
    all,
  }
}

// =============================================================================
// SINGLE CRITERION EVALUATORS
// =============================================================================

async function evaluateSingleCriterion(criterion, workItem) {
  switch (criterion.criteria_tier) {
    case 'manual':
      return evaluateManual(criterion, workItem)
    case 'codified':
      return evaluateCodified(criterion, workItem)
    case 'api':
      return evaluateApi(criterion, workItem)
    default:
      console.warn(`[exitCriteria] Unknown criteria_tier: "${criterion.criteria_tier}"`)
      return { passed: false, reason: `Unknown criteria tier: ${criterion.criteria_tier}` }
  }
}

/**
 * Manual — check if a human has explicitly acknowledged this criterion.
 * Looks for a 'met' or 'waived' status in exit_criteria_status.
 */
async function evaluateManual(criterion, workItem) {
  const result = await query(`
    SELECT status FROM runtime.exit_criteria_status
    WHERE exit_criteria_id = $1
      AND work_item_id = $2
  `, [criterion.id, workItem.id])

  const row = result.rows[0]
  if (row && (row.status === 'met' || row.status === 'waived')) {
    return { passed: true }
  }
  return { passed: false, reason: `"${criterion.name}" has not been manually confirmed` }
}

/**
 * Codified — evaluate a structured condition against runtime state.
 * Condition types: field_value, child_items_terminal,
 *                  child_stage_class_terminal, checklist_complete
 */
async function evaluateCodified(criterion, workItem) {
  const condition = criterion.codified_condition
  if (!condition?.type) {
    return { passed: false, reason: 'Codified condition is missing or malformed' }
  }

  switch (condition.type) {

    case 'field_value': {
      const fieldValues = workItem.field_values || {}
      const actual = fieldValues[condition.field_key]
      const passes = evaluateOperator(actual, condition.operator, condition.value)
      if (passes) return { passed: true }
      return {
        passed: false,
        reason: `Field "${condition.field_key}" ${condition.operator} ${condition.value} not satisfied (actual: ${actual ?? 'empty'})`,
      }
    }

    case 'child_items_terminal': {
      // All child work items of a given type must be in a terminal stage
      const result = await query(`
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE s.is_terminal = true) AS terminal_count
        FROM runtime.work_items wi
        JOIN blueprint.stages s ON s.id = wi.current_stage_id
        WHERE wi.parent_id = $1
          AND wi.work_item_type_id = $2
          AND wi.spawn_state NOT IN ('cancelled')
      `, [workItem.id, condition.work_item_type_id])

      const { total, terminal_count } = result.rows[0]
      if (parseInt(total) === 0 && condition.require_at_least_one) {
        return { passed: false, reason: 'No child work items of the required type exist' }
      }
      if (parseInt(total) !== parseInt(terminal_count)) {
        return {
          passed: false,
          reason: `${parseInt(total) - parseInt(terminal_count)} child work item(s) of the required type are not yet complete`,
        }
      }
      return { passed: true }
    }

    case 'child_stage_class_terminal': {
      // At least N child items with a given stage class must be terminal
      const minCount = condition.min_count || 1
      const result = await query(`
        SELECT COUNT(*) AS terminal_count
        FROM runtime.work_items wi
        JOIN blueprint.stages s ON s.id = wi.current_stage_id
        WHERE wi.parent_id = $1
          AND s.stage_class = $2
          AND s.is_terminal = true
          AND wi.spawn_state NOT IN ('cancelled')
      `, [workItem.id, condition.stage_class])

      const terminalCount = parseInt(result.rows[0].terminal_count)
      if (terminalCount >= minCount) return { passed: true }
      return {
        passed: false,
        reason: `Requires at least ${minCount} "${condition.stage_class}" item(s) to be complete (found ${terminalCount})`,
      }
    }

    case 'checklist_complete': {
      const result = await query(`
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE is_checked = true) AS completed
        FROM runtime.checklist_completions
        WHERE checklist_id = $1 AND work_item_id = $2
      `, [condition.checklist_id, workItem.id])

      const { total, completed } = result.rows[0]
      if (parseInt(total) === 0) {
        return { passed: false, reason: 'Checklist has no items' }
      }
      if (parseInt(total) !== parseInt(completed)) {
        return {
          passed: false,
          reason: `Checklist incomplete: ${completed}/${total} items done`,
        }
      }
      return { passed: true }
    }

    default:
      return { passed: false, reason: `Unknown codified condition type: "${condition.type}"` }
  }
}

/**
 * API — call external endpoint and evaluate response.
 * Failures (network errors, timeouts) BLOCK the transition.
 */
async function evaluateApi(criterion, workItem) {
  if (!criterion.api_endpoint) {
    return { passed: false, reason: 'API criterion has no endpoint configured' }
  }

  // Build payload from template — replace {{field_key}} with work item field values
  const payload = interpolateTemplate(criterion.api_payload_template, workItem)

  try {
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      (criterion.api_timeout_seconds || 10) * 1000
    )

    const response = await fetch(criterion.api_endpoint, {
      method:  criterion.api_method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body:    criterion.api_method === 'POST' ? JSON.stringify(payload) : undefined,
      signal:  controller.signal,
    })
    clearTimeout(timeout)

    const responseBody = await response.json().catch(() => ({}))

    // Evaluate success condition against response
    if (criterion.api_success_condition) {
      const passes = evaluateJsonPath(responseBody, criterion.api_success_condition)
      if (passes) return { passed: true }
      return {
        passed: false,
        reason: `API response did not meet success condition (status: ${response.status})`,
      }
    }

    // No success condition — treat 2xx as pass
    if (response.ok) return { passed: true }
    return { passed: false, reason: `API returned status ${response.status}` }

  } catch (err) {
    // Network error or timeout — BLOCK the transition
    const reason = err.name === 'AbortError'
      ? `API criterion timed out after ${criterion.api_timeout_seconds}s`
      : `API criterion failed: ${err.message}`
    return { passed: false, reason }
  }
}

// =============================================================================
// STATUS MANAGEMENT
// =============================================================================

/**
 * Populate exit_criteria_status rows when a work item enters a new stage.
 * Creates 'pending' rows for each active criterion on the stage.
 * Called from the transition engine after the work item moves.
 *
 * @param {Object} client - PG client (inside transaction) or null for pool query
 * @param {number} workItemId
 * @param {number} stageId
 */
export async function populateExitCriteriaStatus(client, workItemId, stageId) {
  const q = client ? client.query.bind(client) : query

  const criteriaResult = await q(`
    SELECT id FROM blueprint.exit_criteria
    WHERE stage_id = $1 AND is_active = true
  `, [stageId])

  for (const row of criteriaResult.rows) {
    await q(`
      INSERT INTO runtime.exit_criteria_status (work_item_id, exit_criteria_id, stage_id, status)
      VALUES ($1, $2, $3, 'pending')
      ON CONFLICT (work_item_id, exit_criteria_id) DO NOTHING
    `, [workItemId, row.id, stageId])
  }
}

/**
 * Acknowledge a manual exit criterion for a work item.
 *
 * @param {number} workItemId
 * @param {number} exitCriteriaId
 * @param {number} userId
 * @returns {Promise<Object>} Updated status row
 */
export async function acknowledgeCriterion(workItemId, exitCriteriaId, userId) {
  const criterionResult = await query(
    'SELECT id, criteria_tier, name FROM blueprint.exit_criteria WHERE id = $1 AND is_active = true',
    [exitCriteriaId]
  )
  if (!criterionResult.rows.length) {
    throw new Error('Exit criterion not found')
  }
  if (criterionResult.rows[0].criteria_tier !== 'manual') {
    throw new Error('Only manual criteria can be acknowledged')
  }

  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(`
      INSERT INTO runtime.exit_criteria_status
        (work_item_id, exit_criteria_id, stage_id, status, acknowledged_by_user_id, acknowledged_at)
      VALUES ($1, $2,
        (SELECT current_stage_id FROM runtime.work_items WHERE id = $1),
        'met', $3, NOW())
      ON CONFLICT (work_item_id, exit_criteria_id)
      DO UPDATE SET
        status = 'met',
        acknowledged_by_user_id = $3,
        acknowledged_at = NOW(),
        updated_at = NOW()
      RETURNING *
    `, [workItemId, exitCriteriaId, userId])

    const { rows: wi } = await client.query('SELECT uri FROM runtime.work_items WHERE id = $1', [workItemId])
    await emitEvent(client, {
      eventType: 'exit_criteria.acknowledged',
      entityId:  workItemId,
      entityUri: wi[0]?.uri ?? null,
      actorId:   userId,
      payload:   { exit_criteria_id: exitCriteriaId, criterion_name: criterionResult.rows[0].name, stage_id: rows[0].stage_id },
    })
    await client.query('COMMIT')
    nudgeAfterCommit()
    return rows[0]
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/**
 * Un-acknowledge a manual exit criterion (set back to pending).
 *
 * @param {number} workItemId
 * @param {number} exitCriteriaId
 * @returns {Promise<Object>} Updated status row
 */
export async function unacknowledgeCriterion(workItemId, exitCriteriaId, userId) {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(`
      UPDATE runtime.exit_criteria_status
      SET status = 'pending',
          acknowledged_by_user_id = NULL,
          acknowledged_at = NULL,
          updated_at = NOW()
      WHERE work_item_id = $1 AND exit_criteria_id = $2
      RETURNING *
    `, [workItemId, exitCriteriaId])

    if (!rows.length) {
      await client.query('ROLLBACK')
      return null
    }

    const { rows: wi } = await client.query('SELECT uri FROM runtime.work_items WHERE id = $1', [workItemId])
    await emitEvent(client, {
      eventType: 'exit_criteria.unacknowledged',
      entityId:  workItemId,
      entityUri: wi[0]?.uri ?? null,
      actorId:   userId ?? null,
      payload:   { exit_criteria_id: exitCriteriaId, stage_id: rows[0].stage_id },
    })
    await client.query('COMMIT')
    nudgeAfterCommit()
    return rows[0]
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/**
 * Waive an exit criterion — authorized override.
 *
 * @param {number} workItemId
 * @param {number} exitCriteriaId
 * @param {number} userId
 * @param {string} reason
 * @returns {Promise<Object>} Updated status row
 */
export async function waiveCriterion(workItemId, exitCriteriaId, userId, reason) {
  if (!reason?.trim()) {
    throw new Error('A reason is required to waive an exit criterion')
  }

  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(`
      INSERT INTO runtime.exit_criteria_status
        (work_item_id, exit_criteria_id, stage_id, status, waived_by_user_id, waived_at, waiver_reason)
      VALUES ($1, $2,
        (SELECT current_stage_id FROM runtime.work_items WHERE id = $1),
        'waived', $3, NOW(), $4)
      ON CONFLICT (work_item_id, exit_criteria_id)
      DO UPDATE SET
        status = 'waived',
        waived_by_user_id = $3,
        waived_at = NOW(),
        waiver_reason = $4,
        updated_at = NOW()
      RETURNING *
    `, [workItemId, exitCriteriaId, userId, reason.trim()])

    const { rows: wi } = await client.query('SELECT uri FROM runtime.work_items WHERE id = $1', [workItemId])
    await emitEvent(client, {
      eventType: 'exit_criteria.waived',
      entityId:  workItemId,
      entityUri: wi[0]?.uri ?? null,
      actorId:   userId,
      payload:   { exit_criteria_id: exitCriteriaId, stage_id: rows[0].stage_id, waiver_reason: reason.trim() },
    })
    await client.query('COMMIT')
    nudgeAfterCommit()
    return rows[0]
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/**
 * Get current exit criteria status for a work item at its current stage.
 *
 * @param {number} workItemId
 * @returns {Promise<Object[]>} Array of criteria with their status
 */
export async function getWorkItemCriteriaStatus(workItemId) {
  const result = await query(`
    SELECT
      ec.id, ec.name, ec.description, ec.criteria_tier, ec.is_blocking,
      ec.codified_condition, ec.display_order,
      ecs.status, ecs.acknowledged_by_user_id, ecs.acknowledged_at,
      ecs.waived_by_user_id, ecs.waived_at, ecs.waiver_reason,
      ecs.last_evaluated_at, ecs.evaluation_result,
      u_ack.display_name AS acknowledged_by_name,
      u_waive.display_name AS waived_by_name
    FROM blueprint.exit_criteria ec
    LEFT JOIN runtime.exit_criteria_status ecs
      ON ecs.exit_criteria_id = ec.id AND ecs.work_item_id = $1
    LEFT JOIN blueprint.users u_ack ON u_ack.id = ecs.acknowledged_by_user_id
    LEFT JOIN blueprint.users u_waive ON u_waive.id = ecs.waived_by_user_id
    WHERE ec.stage_id = (SELECT current_stage_id FROM runtime.work_items WHERE id = $1)
      AND ec.is_active = true
    ORDER BY ec.display_order ASC, ec.id ASC
  `, [workItemId])

  return result.rows
}

/**
 * Upsert a criteria status row during evaluation.
 * For manual criteria, don't overwrite 'met' or 'waived' status.
 */
async function upsertCriteriaStatus(workItemId, criterion, newStatus, evalResult) {
  // For manual criteria, preserve existing acknowledgments
  if (criterion.criteria_tier === 'manual') {
    await query(`
      INSERT INTO runtime.exit_criteria_status
        (work_item_id, exit_criteria_id, stage_id, status)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (work_item_id, exit_criteria_id) DO NOTHING
    `, [workItemId, criterion.id, criterion.stage_id, newStatus])
    return
  }

  // For codified/api criteria, update with evaluation result
  await query(`
    INSERT INTO runtime.exit_criteria_status
      (work_item_id, exit_criteria_id, stage_id, status, last_evaluated_at, evaluation_result)
    VALUES ($1, $2, $3, $4, NOW(), $5)
    ON CONFLICT (work_item_id, exit_criteria_id)
    DO UPDATE SET
      status = CASE
        WHEN runtime.exit_criteria_status.status = 'waived' THEN 'waived'
        ELSE $4
      END,
      last_evaluated_at = NOW(),
      evaluation_result = $5,
      updated_at = NOW()
  `, [workItemId, criterion.id, criterion.stage_id, newStatus,
      JSON.stringify({ passed: evalResult.passed, reason: evalResult.reason })])
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Evaluate a comparison operator.
 */
function evaluateOperator(actual, operator, expected) {
  switch (operator) {
    case 'eq':  return actual == expected
    case 'neq': return actual != expected
    case 'gt':  return Number(actual) > Number(expected)
    case 'gte': return Number(actual) >= Number(expected)
    case 'lt':  return Number(actual) < Number(expected)
    case 'lte': return Number(actual) <= Number(expected)
    case 'exists': return actual !== null && actual !== undefined && actual !== ''
    case 'not_exists': return actual === null || actual === undefined || actual === ''
    default:
      console.warn(`[exitCriteria] Unknown operator: "${operator}"`)
      return false
  }
}

/**
 * Evaluate a JSONPath-style condition against a response body.
 * Condition: { path: "$.status", operator: "eq", value: "approved" }
 * Supports simple dot-notation paths only for now.
 */
function evaluateJsonPath(obj, condition) {
  try {
    const path  = condition.path.replace(/^\$\./, '').split('.')
    const value = path.reduce((acc, key) => acc?.[key], obj)
    return evaluateOperator(value, condition.operator, condition.value)
  } catch {
    return false
  }
}

/**
 * Replace {{field_key}} placeholders in a template with work item field values.
 */
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

export default {
  evaluateExitCriteria,
  populateExitCriteriaStatus,
  acknowledgeCriterion,
  unacknowledgeCriterion,
  waiveCriterion,
  getWorkItemCriteriaStatus,
}
