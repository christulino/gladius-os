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

import { query }  from '../db/postgres.js'

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
  if (!criteria.length) return { passed: true, failed: [], warnings: [] }

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

  for (const criterion of criteria) {
    const result = await evaluateSingleCriterion(criterion, workItem)

    if (!result.passed) {
      if (criterion.is_blocking) {
        failed.push({
          id:          criterion.id,
          name:        criterion.name,
          tier:        criterion.criteria_tier,
          reason:      result.reason,
          is_blocking: true,
        })
      } else {
        warnings.push({
          id:          criterion.id,
          name:        criterion.name,
          tier:        criterion.criteria_tier,
          reason:      result.reason,
          is_blocking: false,
        })
      }
    }
  }

  return {
    passed:   failed.length === 0,
    failed,
    warnings,
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
 * Manual — check if a human has explicitly completed this criterion.
 * Looks for a completion record in exit_criteria_completions.
 */
async function evaluateManual(criterion, workItem) {
  const result = await query(`
    SELECT id FROM runtime.exit_criteria_completions
    WHERE exit_criteria_id = $1
      AND work_item_id = $2
      AND is_active = true
  `, [criterion.id, workItem.id])

  if (result.rows.length) {
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
               COUNT(*) FILTER (WHERE is_completed = true) AS completed
        FROM runtime.checklist_items
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

export default { evaluateExitCriteria }
