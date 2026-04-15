/**
 * api/routes/workItems.js
 * Work item REST routes.
 *
 * URIs are passed as query parameters (not path segments) to avoid
 * Express misinterpreting the slashes in flowos:// URIs.
 *
 * GET  /v1/work-items?uri=flowos://...              — get a work item
 * GET  /v1/work-items/hierarchy?uri=flowos://...    — get full hierarchy tree
 * GET  /v1/work-items/transition/prepare?uri=...&to_stage_id=N
 * POST /v1/work-items/transition                    — execute a stage transition
 *   body: { uri, to_stage_id, reason?, spawn_decisions? }
 */

import { Router }               from 'express'
import { getWorkItemHierarchy } from '../../graph/hierarchy.js'
import { prepareTransition, executeTransition } from '../../runtime/transitions.js'
import { createWorkItem, updateWorkItemFields, ValidationError } from '../../runtime/workItems.js'
import { query }                from '../../db/postgres.js'

const router = Router()

/**
 * GET /v1/work-items?uri=flowos://...
 */
router.get('/', async (req, res, next) => {
  try {
    const uri = req.query.uri
    if (!uri) return res.status(400).json({ error: 'uri query parameter is required' })

    const result = await query(`
      SELECT wi.*, s.name AS current_stage_name, s.stage_class AS current_stage_class,
        sc.name AS service_class_name
      FROM runtime.work_items wi
      LEFT JOIN blueprint.stages s           ON s.id  = wi.current_stage_id
      LEFT JOIN blueprint.service_classes sc ON sc.id = wi.service_class_id
      WHERE wi.uri = $1
    `, [uri])

    if (!result.rows.length) return res.status(404).json({ error: 'Work item not found' })

    const relationships = await query(`
      SELECT u.uri AS user_uri, u.display_name, wiur.relationship_type, wiur.assigned_at
      FROM runtime.work_item_user_relationships wiur
      JOIN blueprint.users u ON u.id = wiur.user_id
      WHERE wiur.work_item_id = $1 AND wiur.is_active = true
    `, [result.rows[0].id])

    res.json({ ...result.rows[0], relationships: relationships.rows })
  } catch (err) { next(err) }
})

/**
 * GET /v1/work-items/hierarchy?uri=flowos://...
 */
router.get('/hierarchy', async (req, res, next) => {
  try {
    const uri    = req.query.uri
    const userId = req.userId
    if (!uri) return res.status(400).json({ error: 'uri query parameter is required' })
    const hierarchy = await getWorkItemHierarchy(uri, userId)
    res.json(hierarchy)
  } catch (err) {
    if (err.message?.includes('Access denied')) return res.status(403).json({ error: err.message })
    if (err.message?.includes('not found'))     return res.status(404).json({ error: err.message })
    next(err)
  }
})

/**
 * GET /v1/work-items/transition/prepare?uri=flowos://...&to_stage_id=N
 */
router.get('/transition/prepare', async (req, res, next) => {
  try {
    const uri       = req.query.uri
    const toStageId = parseInt(req.query.to_stage_id)
    const userId    = req.userId
    if (!uri)       return res.status(400).json({ error: 'uri query parameter is required' })
    if (!toStageId) return res.status(400).json({ error: 'to_stage_id query parameter is required' })
    const workItemResult = await query('SELECT id FROM runtime.work_items WHERE uri = $1', [uri])
    if (!workItemResult.rows.length) return res.status(404).json({ error: 'Work item not found' })
    const prep = await prepareTransition(workItemResult.rows[0].id, toStageId, userId)
    res.json(prep)
  } catch (err) { next(err) }
})

/**
 * POST /v1/work-items/transition
 * Body: { uri, to_stage_id, reason?, spawn_decisions? }
 */
router.post('/transition', async (req, res, next) => {
  try {
    const { uri, to_stage_id, reason, spawn_decisions } = req.body
    const userId = req.userId
    if (!uri)         return res.status(400).json({ error: 'uri is required' })
    if (!to_stage_id) return res.status(400).json({ error: 'to_stage_id is required' })
    const workItemResult = await query('SELECT id FROM runtime.work_items WHERE uri = $1', [uri])
    if (!workItemResult.rows.length) return res.status(404).json({ error: 'Work item not found' })
    const result = await executeTransition(
      workItemResult.rows[0].id, to_stage_id, userId,
      { reason, spawnDecisions: spawn_decisions || {} }
    )
    if (!result.success) return res.status(422).json({ error: result.error, details: result.details })
    res.json(result)
  } catch (err) { next(err) }
})

/**
 * POST /v1/work-items
 * Create a new work item.
 * Body: { work_item_type_id, owner_org_id, title, service_class_id?, parent_id?, field_values?, description? }
 */
router.post('/', async (req, res, next) => {
  try {
    const userId = req.userId
    const workItem = await createWorkItem(req.body, userId)
    res.status(201).json(workItem)
  } catch (err) {
    if (err instanceof ValidationError) return res.status(err.statusCode).json({ error: err.message })
    next(err)
  }
})

/**
 * PATCH /v1/work-items?uri=flowos://...
 * Update field values on a work item.
 * Body: { field_values: { key: value } }
 */
router.patch('/', async (req, res, next) => {
  try {
    const uri    = req.query.uri
    const userId = req.userId
    if (!uri) return res.status(400).json({ error: 'uri query parameter is required' })
    if (!req.body.field_values) return res.status(400).json({ error: 'field_values is required' })
    const workItem = await updateWorkItemFields(uri, req.body.field_values, userId)
    res.json(workItem)
  } catch (err) {
    if (err instanceof ValidationError) return res.status(err.statusCode).json({ error: err.message })
    next(err)
  }
})

export default router
