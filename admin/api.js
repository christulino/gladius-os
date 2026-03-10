/**
 * admin/api.js
 * Admin-only API endpoints for the Data Browser and Test Harness.
 * Mounted at /admin/api by server.js
 *
 * These endpoints are for development and internal tooling only.
 * In production these should be behind authentication.
 */

import { Router } from 'express'
import { query }  from '../db/postgres.js'
import { getBuffer, sseHandler } from './logger.js'

const router = Router()

// Allowed raw tables — explicit whitelist for safety
const ALLOWED_TABLES = {
  // blueprint
  'blueprint.organizations':                 'blueprint',
  'blueprint.users':                         'blueprint',
  'blueprint.roles':                         'blueprint',
  'blueprint.org_memberships':               'blueprint',
  'blueprint.work_item_type_classes':        'blueprint',
  'blueprint.work_item_types':               'blueprint',
  'blueprint.work_item_type_fields':         'blueprint',
  'blueprint.service_classes':               'blueprint',
  'blueprint.workflows':                     'blueprint',
  'blueprint.stages':                        'blueprint',
  'blueprint.stage_transitions':             'blueprint',
  'blueprint.exit_criteria':                 'blueprint',
  'blueprint.transition_actions':            'blueprint',
  'blueprint.connections':                   'blueprint',
  'blueprint.business_calendars':            'blueprint',
  'blueprint.visibility_rules':              'blueprint',
  'blueprint.service_catalog_items':         'blueprint',
  // runtime
  'runtime.work_items':                      'runtime',
  'runtime.stage_transition_history':        'runtime',
  'runtime.work_item_user_relationships':    'runtime',
  'runtime.work_item_comments':              'runtime',
  'runtime.evidence':                        'runtime',
  'runtime.notifications':                   'runtime',
  'runtime.flow_metrics_snapshots':          'runtime',
  'runtime.search_index_queue':              'runtime',
  'runtime.transition_action_log':           'runtime',
}

// =============================================================================
// ORGANIZATIONS
// =============================================================================

router.get('/organizations', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        o.id, o.uri, o.slug, o.name, o.org_type,
        o.is_active, o.created_at,
        p.name AS parent_name,
        (SELECT COUNT(*) FROM blueprint.org_memberships om WHERE om.org_id = o.id AND om.is_active = true) AS member_count,
        (SELECT COUNT(*) FROM runtime.work_items wi WHERE wi.owner_org_id = o.id) AS work_item_count
      FROM blueprint.organizations o
      LEFT JOIN blueprint.organizations p ON p.id = o.parent_id
      ORDER BY o.id ASC
    `)
    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

// =============================================================================
// WORK ITEMS
// =============================================================================

router.get('/work-items', async (req, res, next) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit)  || 50, 200)
    const offset = parseInt(req.query.offset) || 0

    const result = await query(`
      SELECT
        wi.id, wi.uri, wi.title,
        wi.spawn_state, wi.current_substate,
        wi.created_at, wi.updated_at, wi.entered_current_stage_at,
        wit.name  AS work_item_type_name,
        s.name    AS current_stage_name,
        s.stage_class AS current_stage_class,
        s.is_terminal AS is_terminal,
        sc.name   AS service_class_name,
        sc.color  AS service_class_color,
        o.name    AS org_name,
        o.slug    AS org_slug,
        wi.field_values,
        wi.pending_missing_fields,
        wi.parent_id
      FROM runtime.work_items wi
      JOIN blueprint.work_item_types wit ON wit.id = wi.work_item_type_id
      JOIN blueprint.stages s            ON s.id   = wi.current_stage_id
      JOIN blueprint.organizations o     ON o.id   = wi.owner_org_id
      LEFT JOIN blueprint.service_classes sc ON sc.id = wi.service_class_id
      ORDER BY wi.id DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset])

    const countResult = await query('SELECT COUNT(*) FROM runtime.work_items')

    res.json({
      rows:   result.rows,
      count:  result.rowCount,
      total:  parseInt(countResult.rows[0].count),
      limit,
      offset,
    })
  } catch (err) { next(err) }
})

// =============================================================================
// WORKFLOWS WITH STAGES
// =============================================================================

router.get('/workflows', async (req, res, next) => {
  try {
    const workflows = await query(`
      SELECT w.id, w.uri, w.name, w.description, w.version,
             w.is_system_default, w.is_active, w.created_at,
             o.name AS owner_org_name
      FROM blueprint.workflows w
      JOIN blueprint.organizations o ON o.id = w.owner_org_id
      ORDER BY w.id ASC
    `)

    const stages = await query(`
      SELECT s.*, w.name AS workflow_name,
        (SELECT COUNT(*) FROM blueprint.stage_transitions st WHERE st.from_stage_id = s.id) AS outbound_transitions,
        (SELECT COUNT(*) FROM blueprint.exit_criteria ec WHERE ec.stage_id = s.id AND ec.is_active = true) AS exit_criteria_count
      FROM blueprint.stages s
      JOIN blueprint.workflows w ON w.id = s.workflow_id
      ORDER BY s.workflow_id ASC, s.display_order ASC
    `)

    const transitions = await query(`
      SELECT st.*,
        fs.name AS from_stage_name,
        ts.name AS to_stage_name
      FROM blueprint.stage_transitions st
      JOIN blueprint.stages fs ON fs.id = st.from_stage_id
      JOIN blueprint.stages ts ON ts.id = st.to_stage_id
      ORDER BY st.from_stage_id ASC
    `)

    // Nest stages and transitions under workflows
    const stagesByWorkflow      = {}
    const transitionsByWorkflow = {}

    for (const stage of stages.rows) {
      if (!stagesByWorkflow[stage.workflow_id]) stagesByWorkflow[stage.workflow_id] = []
      stagesByWorkflow[stage.workflow_id].push(stage)
    }

    for (const t of transitions.rows) {
      // Find workflow via from_stage
      const stage = stages.rows.find(s => s.id === t.from_stage_id)
      if (!stage) continue
      if (!transitionsByWorkflow[stage.workflow_id]) transitionsByWorkflow[stage.workflow_id] = []
      transitionsByWorkflow[stage.workflow_id].push(t)
    }

    const result = workflows.rows.map(wf => ({
      ...wf,
      stages:      stagesByWorkflow[wf.id]      || [],
      transitions: transitionsByWorkflow[wf.id] || [],
    }))

    res.json({ rows: result, count: result.length })
  } catch (err) { next(err) }
})

// =============================================================================
// USERS AND MEMBERSHIPS
// =============================================================================

router.get('/users', async (req, res, next) => {
  try {
    const users = await query(`
      SELECT u.id, u.uri, u.email, u.display_name,
             u.is_active, u.is_system, u.created_at
      FROM blueprint.users u
      ORDER BY u.id ASC
    `)

    const memberships = await query(`
      SELECT om.user_id, om.org_id, om.is_active,
             o.name AS org_name, o.slug AS org_slug,
             r.name AS role_name
      FROM blueprint.org_memberships om
      JOIN blueprint.organizations o ON o.id = om.org_id
      JOIN blueprint.roles r         ON r.id = om.role_id
      ORDER BY om.user_id ASC
    `)

    const membershipsByUser = {}
    for (const m of memberships.rows) {
      if (!membershipsByUser[m.user_id]) membershipsByUser[m.user_id] = []
      membershipsByUser[m.user_id].push(m)
    }

    const result = users.rows.map(u => ({
      ...u,
      memberships: membershipsByUser[u.id] || [],
    }))

    res.json({ rows: result, count: result.length })
  } catch (err) { next(err) }
})

// =============================================================================
// TRANSITION HISTORY
// =============================================================================

router.get('/transition-history', async (req, res, next) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit) || 50, 200)
    const offset = parseInt(req.query.offset) || 0

    const result = await query(`
      SELECT
        sth.id, sth.work_item_id,
        wi.title       AS work_item_title,
        wi.uri         AS work_item_uri,
        fs.name        AS from_stage_name,
        fs.stage_class AS from_stage_class,
        ts.name        AS to_stage_name,
        ts.stage_class AS to_stage_class,
        sth.entered_from_stage_at,
        sth.exited_from_stage_at,
        sth.time_in_stage_seconds,
        sth.working_time_in_stage_seconds,
        sth.transition_reason,
        sth.was_automated,
        sth.created_at,
        u.display_name AS transitioned_by
      FROM runtime.stage_transition_history sth
      JOIN runtime.work_items wi ON wi.id   = sth.work_item_id
      JOIN blueprint.stages   fs ON fs.id   = sth.from_stage_id
      JOIN blueprint.stages   ts ON ts.id   = sth.to_stage_id
      LEFT JOIN blueprint.users u ON u.id   = sth.transitioned_by_user_id
      ORDER BY sth.id DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset])

    const countResult = await query('SELECT COUNT(*) FROM runtime.stage_transition_history')

    res.json({
      rows:   result.rows,
      count:  result.rowCount,
      total:  parseInt(countResult.rows[0].count),
      limit,
      offset,
    })
  } catch (err) { next(err) }
})

// =============================================================================
// RAW TABLE BROWSER
// =============================================================================

router.get('/tables', async (req, res, next) => {
  try {
    res.json({ tables: Object.keys(ALLOWED_TABLES) })
  } catch (err) { next(err) }
})

router.get('/tables/:schema/:table', async (req, res, next) => {
  try {
    const tableName = `${req.params.schema}.${req.params.table}`
    if (!ALLOWED_TABLES[tableName]) {
      return res.status(403).json({ error: `Table "${tableName}" is not accessible` })
    }

    const limit  = Math.min(parseInt(req.query.limit) || 50, 500)
    const offset = parseInt(req.query.offset) || 0

    const result      = await query(`SELECT * FROM ${tableName} ORDER BY id ASC LIMIT $1 OFFSET $2`, [limit, offset])
    const countResult = await query(`SELECT COUNT(*) FROM ${tableName}`)

    res.json({
      table:   tableName,
      columns: result.fields.map(f => f.name),
      rows:    result.rows,
      count:   result.rowCount,
      total:   parseInt(countResult.rows[0].count),
      limit,
      offset,
    })
  } catch (err) { next(err) }
})

// =============================================================================
// SYSTEM SUMMARY (dashboard)
// =============================================================================

router.get('/summary', async (req, res, next) => {
  try {
    const [orgs, users, workItems, workflows, transitions, queueDepth] = await Promise.all([
      query('SELECT COUNT(*) FROM blueprint.organizations WHERE is_active = true'),
      query('SELECT COUNT(*) FROM blueprint.users WHERE is_active = true'),
      query(`SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE spawn_state = 'active')  AS active,
        COUNT(*) FILTER (WHERE spawn_state = 'pending') AS pending,
        COUNT(*) FILTER (WHERE spawn_state = 'done')    AS done,
        COUNT(*) FILTER (WHERE spawn_state = 'cancelled') AS cancelled
        FROM runtime.work_items`),
      query('SELECT COUNT(*) FROM blueprint.workflows WHERE is_active = true'),
      query('SELECT COUNT(*) FROM runtime.stage_transition_history'),
      query("SELECT COUNT(*) FROM runtime.search_index_queue WHERE status = 'pending'"),
    ])

    res.json({
      orgs:        parseInt(orgs.rows[0].count),
      users:       parseInt(users.rows[0].count),
      work_items:  workItems.rows[0],
      workflows:   parseInt(workflows.rows[0].count),
      transitions: parseInt(transitions.rows[0].count),
      sync_queue_depth: parseInt(queueDepth.rows[0].count),
    })
  } catch (err) { next(err) }
})

// =============================================================================
// LOG VIEWER
// =============================================================================

// GET /admin/api/logs — return buffer snapshot
router.get('/logs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 200, 500)
  const buf   = getBuffer()
  res.json({ entries: buf.slice(-limit), total: buf.length })
})

// GET /admin/api/logs/stream — SSE live stream
router.get('/logs/stream', sseHandler)

// =============================================================================
// DB CONSOLE
// =============================================================================

// Allowed statement prefixes — read-only only
const ALLOWED_PREFIXES = ['select', 'explain', 'with']

router.post('/query', async (req, res, next) => {
  try {
    const sql = (req.body.sql || '').trim()
    if (!sql) return res.status(400).json({ error: 'sql is required' })

    const first = sql.toLowerCase().split(/\s+/)[0]
    if (!ALLOWED_PREFIXES.includes(first)) {
      return res.status(403).json({
        error: `Only ${ALLOWED_PREFIXES.join(', ')} statements are allowed`,
      })
    }

    // Only append LIMIT if the query doesn't already have one
    const alreadyLimited = /\bLIMIT\b/i.test(sql)
    const safeSql = alreadyLimited
      ? sql.replace(/;+$/, '')
      : sql.replace(/;+$/, '') + '\nLIMIT 500'

    const start  = Date.now()
    const result = await query(safeSql)
    const ms     = Date.now() - start

    res.json({
      columns:  result.fields.map(f => ({ name: f.name, type: f.dataTypeID })),
      rows:     result.rows,
      count:    result.rowCount,
      duration_ms: ms,
    })
  } catch (err) {
    // Return DB errors as 422 so the console can display them nicely
    res.status(422).json({ error: err.message })
  }
})

// =============================================================================
// EDIT — whitelisted field updates for admin browser
// =============================================================================

// Defines exactly which fields are editable per entity type
const EDIT_RULES = {
  'work_item': {
    table:           'runtime.work_items',
    allowed_fields:  ['title', 'description', 'field_values'],
    field_types:     { title: 'text', description: 'text', field_values: 'json' },
    id_column:       'id',
  },
  'organization': {
    table:           'blueprint.organizations',
    allowed_fields:  ['name', 'is_active'],
    field_types:     { name: 'text', is_active: 'boolean' },
    id_column:       'id',
  },
}

/**
 * PATCH /admin/api/edit/:entityType/:id
 * Update whitelisted fields on a single record.
 * Body: { field: value, ... }
 */
router.patch('/edit/:entityType/:id', async (req, res, next) => {
  try {
    const { entityType, id } = req.params
    const rules = EDIT_RULES[entityType]

    if (!rules) {
      return res.status(403).json({
        error: `Entity type "${entityType}" is not editable`,
        allowed: Object.keys(EDIT_RULES),
      })
    }

    const updates = req.body
    if (!updates || !Object.keys(updates).length) {
      return res.status(400).json({ error: 'No fields provided' })
    }

    // Filter to only allowed fields
    const safeUpdates = {}
    const rejected    = []
    for (const [field, value] of Object.entries(updates)) {
      if (rules.allowed_fields.includes(field)) {
        safeUpdates[field] = value
      } else {
        rejected.push(field)
      }
    }

    if (rejected.length) {
      return res.status(403).json({
        error:    `Fields not editable: ${rejected.join(', ')}`,
        allowed:  rules.allowed_fields,
      })
    }

    if (!Object.keys(safeUpdates).length) {
      return res.status(400).json({ error: 'No valid fields to update' })
    }

    // Validate types
    for (const [field, value] of Object.entries(safeUpdates)) {
      const expectedType = rules.field_types[field]
      if (expectedType === 'boolean' && typeof value !== 'boolean') {
        return res.status(400).json({ error: `Field "${field}" must be a boolean` })
      }
      if (expectedType === 'text' && typeof value !== 'string') {
        return res.status(400).json({ error: `Field "${field}" must be a string` })
      }
      if (expectedType === 'json' && typeof value !== 'object') {
        return res.status(400).json({ error: `Field "${field}" must be an object` })
      }
    }

    // Build parameterized UPDATE
    const fields   = Object.keys(safeUpdates)
    const values   = fields.map(f =>
      rules.field_types[f] === 'json'
        ? JSON.stringify(safeUpdates[f])
        : safeUpdates[f]
    )
    const setClauses = fields.map((f, i) => `${f} = $${i + 1}`).join(', ')
    values.push(new Date()) // updated_at
    values.push(id)         // WHERE id = $N

    const sql = `
      UPDATE ${rules.table}
      SET ${setClauses}, updated_at = $${fields.length + 1}
      WHERE ${rules.id_column} = $${fields.length + 2}
      RETURNING *
    `

    const result = await query(sql, values)
    if (!result.rows.length) {
      return res.status(404).json({ error: `${entityType} ${id} not found` })
    }

    res.json({ updated: result.rows[0], fields_changed: fields })
  } catch (err) { next(err) }
})

/**
 * GET /admin/api/edit/rules
 * Returns the edit rules so the UI knows what's editable.
 */
router.get('/edit/rules', (_req, res) => {
  const rules = {}
  for (const [type, r] of Object.entries(EDIT_RULES)) {
    rules[type] = { allowed_fields: r.allowed_fields, field_types: r.field_types }
  }
  res.json(rules)
})

export default router
