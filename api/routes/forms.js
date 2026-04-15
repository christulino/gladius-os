/**
 * api/routes/forms.js
 * Public intake form routes — no authentication required.
 *
 * GET  /forms/:slug       — form configuration (type, fields, org info)
 * POST /forms/:slug       — submit a work item via the intake form
 *
 * The slug comes from service_catalog_items.external_slug.
 * Only items with is_external = true are accessible here.
 */

import { Router } from 'express'
import { query }  from '../../db/postgres.js'
import { createWorkItem, ValidationError } from '../../runtime/workItems.js'

const router = Router()

// ─── GET /forms/:slug — Form configuration ──────────────────────────────────

router.get('/:slug', async (req, res, next) => {
  try {
    const { slug } = req.params

    // Load catalog item + type + org info
    const result = await query(`
      SELECT
        sci.id              AS catalog_item_id,
        sci.name            AS catalog_name,
        sci.description     AS catalog_description,
        sci.external_slug,
        sci.requires_approval,
        wit.id              AS work_item_type_id,
        wit.name            AS type_name,
        wit.description     AS type_description,
        wit.icon            AS type_icon,
        wit.color           AS type_color,
        wit.key_prefix,
        wit.default_acceptance_criteria,
        witc.name           AS class_name,
        o.id                AS org_id,
        o.name              AS org_name,
        o.slug              AS org_slug
      FROM blueprint.service_catalog_items sci
      JOIN blueprint.work_item_types wit       ON wit.id = sci.work_item_type_id
      JOIN blueprint.work_item_type_classes witc ON witc.id = wit.class_id
      JOIN blueprint.organizations o           ON o.id = sci.owner_org_id
      WHERE sci.external_slug = $1
        AND sci.is_external = true
        AND sci.is_active = true
        AND wit.is_active = true
        AND o.is_active = true
    `, [slug])

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Form not found' })
    }

    const item = result.rows[0]

    // Load field definitions for this type
    const fieldsResult = await query(`
      SELECT
        f.id, f.field_key, f.field_label, f.field_type,
        f.field_options, f.field_group, f.is_required,
        f.display_order, f.lookup_list_id, f.constraints,
        f.default_value
      FROM blueprint.work_item_type_fields f
      WHERE f.work_item_type_id = $1
        AND f.is_active = true
      ORDER BY f.display_order ASC, f.field_label ASC
    `, [item.work_item_type_id])

    // For fields with lookup_list_id, load their values
    const lookupListIds = fieldsResult.rows
      .map(f => f.lookup_list_id)
      .filter(Boolean)

    let lookupValues = {}
    if (lookupListIds.length > 0) {
      const lvResult = await query(`
        SELECT lv.list_id, lv.id, lv.label, lv.sort_order
        FROM blueprint.lookup_values lv
        WHERE lv.list_id = ANY($1)
          AND lv.is_active = true
        ORDER BY lv.sort_order ASC, lv.label ASC
      `, [lookupListIds])

      for (const row of lvResult.rows) {
        if (!lookupValues[row.list_id]) lookupValues[row.list_id] = []
        lookupValues[row.list_id].push({ id: row.id, label: row.label })
      }
    }

    // Enrich fields with lookup values
    const fields = fieldsResult.rows.map(f => ({
      ...f,
      lookup_values: f.lookup_list_id ? (lookupValues[f.lookup_list_id] || []) : undefined,
    }))

    res.json({
      form: {
        slug:         item.external_slug,
        title:        item.catalog_name,
        description:  item.catalog_description,
        org_name:     item.org_name,
        type_name:    item.type_name,
        type_icon:    item.type_icon,
        type_color:   item.type_color,
        class_name:   item.class_name,
        requires_approval: item.requires_approval,
      },
      fields,
      _meta: {
        work_item_type_id: item.work_item_type_id,
        org_id:            item.org_id,
      },
    })
  } catch (err) {
    next(err)
  }
})

// ─── POST /forms/:slug — Submit intake form ─────────────────────────────────

router.post('/:slug', async (req, res, next) => {
  try {
    const { slug } = req.params
    const {
      title,
      description,
      field_values = {},
      requester_name,
      requester_email,
      due_date,
      is_expedited,
      work_nature,
    } = req.body

    // Resolve catalog item
    const catResult = await query(`
      SELECT
        sci.id, sci.work_item_type_id, sci.owner_org_id, sci.requires_approval
      FROM blueprint.service_catalog_items sci
      WHERE sci.external_slug = $1
        AND sci.is_external = true
        AND sci.is_active = true
    `, [slug])

    if (!catResult.rows.length) {
      return res.status(404).json({ error: 'Form not found' })
    }

    const catalog = catResult.rows[0]

    if (!title?.trim()) {
      return res.status(422).json({ error: 'Title is required' })
    }

    // Resolve or create requester user (if email provided)
    let requesterId = null
    if (requester_email?.trim()) {
      const userResult = await query(
        'SELECT id FROM blueprint.users WHERE email = $1',
        [requester_email.trim().toLowerCase()]
      )
      if (userResult.rows.length) {
        requesterId = userResult.rows[0].id
      } else {
        // Create a minimal external user record
        const insertUser = await query(`
          INSERT INTO blueprint.users (display_name, email, is_active, created_at, updated_at)
          VALUES ($1, $2, true, NOW(), NOW())
          RETURNING id
        `, [
          requester_name?.trim() || requester_email.trim().split('@')[0],
          requester_email.trim().toLowerCase(),
        ])
        requesterId = insertUser.rows[0].id
      }
    }

    // Create the work item via the standard engine
    // userId = null for anonymous submissions (no session user)
    const workItem = await createWorkItem({
      work_item_type_id: catalog.work_item_type_id,
      owner_org_id:      catalog.owner_org_id,
      title:             title.trim(),
      description:       description || undefined,
      field_values,
      due_date:          due_date || undefined,
      is_expedited:      is_expedited || false,
      work_nature:       work_nature || 'delivery',
      origin:            'web',
      requester_id:      requesterId,
    }, requesterId)

    res.status(201).json({
      success: true,
      message: catalog.requires_approval
        ? 'Your request has been submitted and is pending approval.'
        : 'Your request has been submitted.',
      work_item: {
        display_key:  workItem.display_key,
        title:        workItem.title,
        status:       workItem.current_stage_name,
        uri:          workItem.uri,
      },
    })
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(422).json({ error: err.message })
    }
    next(err)
  }
})

export default router
