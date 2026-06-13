/**
 * board/boardQuery.js
 * Assembles the Kanban board data set.
 *
 * Execution pattern:
 *   Step 1 — Neo4j:       resolve which org URIs to include
 *   Step 2 — PostgreSQL:  fetch active work items for those orgs
 *   Step 3 — PostgreSQL:  fetch stage and service class metadata for columns/swimlanes
 *   Step 4 — Application: group into 2D grid structure
 *
 * Neo4j handles the hierarchy traversal.
 * PostgreSQL handles the data — fast with the composite board index.
 *
 * Usage:
 *   import { getBoardData } from '../board/boardQuery.js'
 *
 *   const board = await getBoardData({
 *     orgUri:    'flowos://engineering/orgs/uuid',
 *     workflowId: 3,
 *     userId:    42,
 *     filters:   { sla_status: ['at_risk', 'breached'] }
 *   })
 */

import { getDescendantOrgUris } from '../graph/orgTree.js'
import { query }                 from '../db/postgres.js'

/**
 * Get the full board data set for an org, grouped into the 2D Kanban structure.
 *
 * @param {Object} options
 * @param {string}   options.orgUri     - Root org URI for the board
 * @param {number}   [options.workflowId] - Filter to a specific workflow. Null = all.
 * @param {number}   options.userId     - Requesting user (for visibility filtering)
 * @param {Object}   [options.filters]  - Optional board view filters
 * @param {boolean}  [options.includeDescendants=true] - Include descendant org work items
 * @returns {Promise<Object>} Board structure
 */
export async function getBoardData({
  orgUri,
  workflowId = null,
  userId: _userId,
  filters = {},
  includeDescendants = true,
}) {
  // Step 1 — Neo4j: which orgs to include
  const orgUris = includeDescendants
    ? await getDescendantOrgUris(orgUri)
    : [orgUri]

  if (!orgUris.length) {
    return emptyBoard()
  }

  // Step 2 — PostgreSQL: fetch active work items
  const items = await fetchActiveWorkItems(orgUris, workflowId, filters)

  // Step 3 — PostgreSQL: fetch stage and service class metadata
  const [stages, serviceClasses] = await Promise.all([
    fetchStageMetadata(workflowId, orgUris),
    fetchServiceClassMetadata(orgUris),
  ])

  // Step 4 — Application: group into 2D grid
  const grid = buildGrid(items, stages, serviceClasses)

  return {
    org_uri:       orgUri,
    workflow_id:   workflowId,
    stages,
    service_classes: serviceClasses,
    grid,
    item_count:    items.length,
    generated_at:  new Date().toISOString(),
  }
}

// =============================================================================
// STEP 2 — POSTGRESQL: WORK ITEMS
// =============================================================================

async function fetchActiveWorkItems(orgUris, workflowId, filters) {
  // Convert org URIs to org IDs via PostgreSQL
  const orgIdResult = await query(
    'SELECT id FROM blueprint.organizations WHERE uri = ANY($1) AND is_active = true',
    [orgUris]
  )
  const orgIds = orgIdResult.rows.map(r => r.id)
  if (!orgIds.length) return []

  // Build dynamic WHERE clauses from filters
  const conditions  = [
    'wi.owner_org_id = ANY($1)',
    "wi.spawn_state = 'active'",
  ]
  const params = [orgIds]
  let   paramIdx = 2

  if (workflowId) {
    conditions.push(`wi.workflow_id = $${paramIdx++}`)
    params.push(workflowId)
  }

  if (filters.sla_status?.length) {
    conditions.push(`wi.sla_status = ANY($${paramIdx++})`)
    params.push(filters.sla_status)
  }

  if (filters.service_class_ids?.length) {
    conditions.push(`wi.service_class_id = ANY($${paramIdx++})`)
    params.push(filters.service_class_ids)
  }

  if (filters.work_item_type_ids?.length) {
    conditions.push(`wi.work_item_type_id = ANY($${paramIdx++})`)
    params.push(filters.work_item_type_ids)
  }

  if (filters.due_before) {
    conditions.push(`wi.due_date <= $${paramIdx++}`)
    params.push(filters.due_before)
  }

  const sql = `
    SELECT
      wi.id,
      wi.uri,
      wi.title,
      wi.current_stage_id,
      wi.current_substate,
      wi.service_class_id,
      wi.sla_status,
      wi.spawn_state,
      wi.due_date,
      wi.owner_org_id,
      wi.entered_current_stage_at,
      wi.field_values,
      wi.parent_id,
      s.name           AS current_stage_name,
      s.stage_class    AS current_stage_class,
      s.sla_hours      AS stage_sla_hours,
      s.wip_limit      AS stage_wip_limit,
      sc.name          AS service_class_name,
      sc.priority_order AS service_class_priority,
      sc.color         AS service_class_color,
      fms.cycle_time_working_seconds,
      fms.lead_time_working_seconds,
      -- Time in current stage (working seconds computed at query time from snapshot)
      fms.current_stage_elapsed_hours
    FROM runtime.work_items wi
    JOIN blueprint.stages s             ON s.id = wi.current_stage_id
    JOIN blueprint.service_classes sc   ON sc.id = wi.service_class_id
    LEFT JOIN runtime.flow_metrics_snapshots fms ON fms.work_item_id = wi.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY sc.priority_order ASC, wi.entered_current_stage_at ASC
  `

  const result = await query(sql, params)
  return result.rows
}

// =============================================================================
// STEP 3 — POSTGRESQL: STAGE AND SERVICE CLASS METADATA
// =============================================================================

async function fetchStageMetadata(workflowId, orgUris) {
  let sql, params

  if (workflowId) {
    sql = `
      SELECT
        s.id, s.uri, s.name, s.stage_class, s.stage_type,
        s.display_order, s.sla_hours, s.wip_limit,
        s.has_waiting_queue, s.requires_review,
        s.requires_evidence, s.measure_substates,
        s.is_entry_stage, s.is_terminal
      FROM blueprint.stages s
      WHERE s.workflow_id = $1 AND s.is_active = true
      ORDER BY s.display_order ASC
    `
    params = [workflowId]
  } else {
    // All workflows for orgs in scope — used for multi-workflow board view
    const orgIdResult = await query(
      'SELECT id FROM blueprint.organizations WHERE uri = ANY($1)',
      [orgUris]
    )
    const orgIds = orgIdResult.rows.map(r => r.id)
    sql = `
      SELECT DISTINCT
        s.id, s.uri, s.name, s.stage_class, s.stage_type,
        s.display_order, s.sla_hours, s.wip_limit,
        s.has_waiting_queue, s.requires_review,
        s.requires_evidence, s.measure_substates,
        s.is_entry_stage, s.is_terminal,
        w.id AS workflow_id, w.name AS workflow_name
      FROM blueprint.stages s
      JOIN blueprint.workflows w ON w.id = s.workflow_id
      JOIN blueprint.work_item_type_workflows witw ON witw.workflow_id = w.id
      JOIN blueprint.work_item_types wit ON wit.id = witw.work_item_type_id
      WHERE wit.owner_org_id = ANY($1) AND s.is_active = true
      ORDER BY s.stage_class, s.display_order ASC
    `
    params = [orgIds]
  }

  const result = await query(sql, params)
  return result.rows
}

async function fetchServiceClassMetadata(orgUris) {
  const orgIdResult = await query(
    'SELECT id FROM blueprint.organizations WHERE uri = ANY($1)',
    [orgUris]
  )
  const orgIds = orgIdResult.rows.map(r => r.id)

  const result = await query(`
    SELECT id, name, priority_order, color, description, wip_limit, is_system_default
    FROM blueprint.service_classes
    WHERE org_id = ANY($1) AND is_active = true
    ORDER BY priority_order ASC
  `, [orgIds])

  return result.rows
}

// =============================================================================
// STEP 4 — APPLICATION: BUILD 2D GRID
// =============================================================================

/**
 * Group work items into a 2D grid keyed by [stage_id][service_class_id][substate].
 *
 * Grid structure:
 * {
 *   [stage_id]: {
 *     [service_class_id]: {
 *       waiting: [ ...items ],
 *       active:  [ ...items ],
 *       review:  [ ...items ],
 *     }
 *   }
 * }
 */
function buildGrid(items, stages, serviceClasses) {
  const grid = {}

  // Initialize empty cells for every stage × service class combination
  for (const stage of stages) {
    grid[stage.id] = {}
    for (const sc of serviceClasses) {
      grid[stage.id][sc.id] = {
        waiting: [],
        active:  [],
        review:  [],
      }
    }
  }

  // Place each work item into the correct cell
  for (const item of items) {
    const stageId   = item.current_stage_id
    const scId      = item.service_class_id
    const substate  = item.current_substate || 'active'

    if (!grid[stageId]) continue           // stage not in this board view
    if (!grid[stageId][scId]) continue     // service class not in this board view

    const validSubstate = ['waiting', 'active', 'review'].includes(substate)
      ? substate
      : 'active'

    grid[stageId][scId][validSubstate].push(formatCard(item))
  }

  // Add WIP counts and limit status to each stage/service class cell
  for (const stage of stages) {
    for (const sc of serviceClasses) {
      const cell = grid[stage.id]?.[sc.id]
      if (!cell) continue

      const activeCount = cell.active.length
      const wipLimit    = stage.wip_limit

      cell._meta = {
        total_count:    cell.waiting.length + cell.active.length + cell.review.length,
        active_count:   activeCount,
        wip_limit:      wipLimit,
        wip_exceeded:   wipLimit ? activeCount > wipLimit : false,
        wip_at_limit:   wipLimit ? activeCount >= wipLimit : false,
      }
    }
  }

  return grid
}

/**
 * Format a work item row into a board card object.
 * Only includes what the card needs to render — keep it lean.
 */
function formatCard(item) {
  return {
    id:                         item.id,
    uri:                        item.uri,
    title:                      item.title,
    current_stage_id:           item.current_stage_id,
    current_stage_name:         item.current_stage_name,
    current_stage_class:        item.current_stage_class,
    current_substate:           item.current_substate,
    service_class_id:           item.service_class_id,
    service_class_name:         item.service_class_name,
    service_class_color:        item.service_class_color,
    sla_status:                 item.sla_status,
    due_date:                   item.due_date,
    entered_current_stage_at:   item.entered_current_stage_at,
    stage_sla_hours:            item.stage_sla_hours,
    current_stage_elapsed_hours:item.current_stage_elapsed_hours,
    cycle_time_working_seconds: item.cycle_time_working_seconds,
    has_parent:                 !!item.parent_id,
  }
}

function emptyBoard() {
  return { stages: [], service_classes: [], grid: {}, item_count: 0, generated_at: new Date().toISOString() }
}

export default { getBoardData }
