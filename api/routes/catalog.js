/**
 * api/routes/catalog.js
 * Service catalog routes — stub for scaffolding.
 *
 * GET  /v1/catalog/:orgUri         — list visible catalog items for an org
 * POST /v1/catalog/:itemUri/request — submit a catalog request (creates work item)
 */

import { Router } from 'express'
import { query }  from '../../db/postgres.js'

const router = Router()

/**
 * GET /v1/catalog/:orgUri
 * Returns catalog items visible and requestable by the user for the given org.
 * Filters out automation_only items entirely.
 * Filters restricted items by visibility rules.
 */
router.get('/:orgUri(*)', async (req, res, next) => {
  try {
    const orgUri = decodeURIComponent(req.params.orgUri)

    // TODO: apply visibility rule filtering via canAccess()
    const result = await query(`
      SELECT
        sci.id, sci.uri, sci.name, sci.description,
        sci.request_mode, sci.is_internal, sci.is_cross_org, sci.is_external,
        wit.name AS work_item_type_name,
        wit.uri  AS work_item_type_uri
      FROM blueprint.service_catalog_items sci
      JOIN blueprint.organizations o       ON o.id = sci.owner_org_id
      JOIN blueprint.work_item_types wit   ON wit.id = sci.work_item_type_id
      WHERE o.uri = $1
        AND sci.is_active = true
        AND sci.request_mode <> 'automation_only'
      ORDER BY sci.name ASC
    `, [orgUri])

    res.json({ catalog_items: result.rows })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /v1/catalog/:itemUri/request
 * Submit a request for a catalog item — creates a work item instance.
 * Body: { field_values: {...}, notes?: string }
 */
router.post('/:itemUri(*)/request', async (req, res, next) => {
  try {
    // TODO: implement full catalog request → work item creation flow
    res.status(501).json({ message: 'Catalog request flow not yet implemented' })
  } catch (err) {
    next(err)
  }
})

export default router
