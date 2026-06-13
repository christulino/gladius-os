/**
 * api/routes/organizations.js
 * Organization routes — stub for scaffolding.
 *
 * GET  /v1/organizations           — list visible orgs for user
 * GET  /v1/organizations/:uri      — get a single org
 * POST /v1/organizations           — create a new org
 */

import { Router } from 'express'
import { query }  from '../../db/postgres.js'

const router = Router()

/**
 * GET /v1/organizations
 * Returns orgs visible to the requesting user.
 * Filtered by visibility rules — only orgs the user can see.
 */
router.get('/', async (req, res, next) => {
  try {
    // TODO: visibility filtering via canAccess() once auth middleware in place
    const result = await query(`
      SELECT id, uri, slug, name, org_type, parent_id, is_active, network_visible
      FROM blueprint.organizations
      WHERE is_active = true
      ORDER BY name ASC
    `)
    res.json({ organizations: result.rows })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /v1/organizations/:uri
 */
router.get('/:uri(*)', async (req, res, next) => {
  try {
    const uri = decodeURIComponent(req.params.uri)
    const result = await query(
      'SELECT * FROM blueprint.organizations WHERE uri = $1',
      [uri]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Organization not found' })
    res.json(result.rows[0])
  } catch (err) {
    next(err)
  }
})

export default router
