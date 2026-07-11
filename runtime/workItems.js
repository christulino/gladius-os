/**
 * runtime/workItems.js
 * Work item creation and field management.
 *
 * Design decisions:
 *   - Missing required fields → pending state, not rejection
 *   - canCreate() is stubbed — visibility rules engine plugs in later
 *   - No hard deletes — work items are cancelled, not destroyed
 */

import { query, getClient } from '../db/postgres.js'
import { generateUri }      from '../core/uri.js'
import { emitEvent, nudgeAfterCommit } from '../core/events.js'
import { randomUUID }       from 'node:crypto'

// =============================================================================
// CREATE
// =============================================================================

/**
 * Create a new work item.
 *
 * @param {Object} params
 * @param {number}  params.work_item_type_id  - blueprint.work_item_types.id
 * @param {number}  params.owner_org_id       - blueprint.organizations.id
 * @param {string}  params.title              - required
 * @param {number}  [params.service_class_id] - defaults to Standard
 * @param {number}  [params.parent_id]        - runtime.work_items.id
 * @param {Object}  [params.field_values]     - { field_key: value }
 * @param {string}  [params.description]
 * @param {number}  userId                    - blueprint.users.id (creator)
 * @returns {Promise<Object>} Created work item with stage and type info
 */
export async function createWorkItem(params, userId) {
  const {
    work_item_type_id,
    owner_org_id,
    title,
    service_class_id,
    parent_id,
    field_values = {},
    description,
    due_date,
    is_expedited = false,
    work_nature = 'delivery',
    priority,
    tags,
    estimate,
    estimate_unit = 'points',
    origin = 'manual',
    requester_id,
  } = params

  // =========================================================================
  // VALIDATE INPUTS
  // =========================================================================

  if (!title?.trim()) {
    throw new ValidationError('title is required')
  }

  // Load and validate work item type
  const typeResult = await query(`
    SELECT wit.*, witc.name AS class_name, wit.key_prefix
    FROM blueprint.work_item_types wit
    JOIN blueprint.work_item_type_classes witc ON witc.id = wit.class_id
    WHERE wit.id = $1 AND wit.is_active = true
  `, [work_item_type_id])

  if (!typeResult.rows.length) {
    throw new ValidationError(`Work item type ${work_item_type_id} not found or inactive`)
  }
  const workItemType = typeResult.rows[0]

  if (!workItemType.is_published) {
    throw new ValidationError(`Work item type "${workItemType.name}" is not published`)
  }

  // Validate org exists and is active
  const orgResult = await query(
    'SELECT id, slug, uri FROM blueprint.organizations WHERE id = $1 AND is_active = true',
    [owner_org_id]
  )
  if (!orgResult.rows.length) {
    throw new ValidationError(`Organization ${owner_org_id} not found or inactive`)
  }
  const org = orgResult.rows[0]

  // TODO: canCreate(userId, work_item_type_id, owner_org_id)
  // Always returns true for now. Visibility rules engine plugs in here.
  // When implemented: checks org catalog visibility, work item type request_mode,
  // and any role-based allow/deny rules on the type.

  // =========================================================================
  // RESOLVE WORKFLOW AND ENTRY STAGE
  // =========================================================================

  const workflowResult = await query(`
    SELECT w.id AS workflow_id, s.id AS entry_stage_id, s.name AS entry_stage_name
    FROM blueprint.work_item_type_workflows witw
    JOIN blueprint.workflows w  ON w.id  = witw.workflow_id
    JOIN blueprint.stages s     ON s.workflow_id = w.id AND s.is_entry_stage = true
    WHERE witw.work_item_type_id = $1
      AND witw.is_current = true
      AND w.is_active = true
      AND s.is_active = true
    LIMIT 1
  `, [work_item_type_id])

  if (!workflowResult.rows.length) {
    throw new ValidationError(`No active workflow with entry stage found for work item type "${workItemType.name}"`)
  }
  const { workflow_id, entry_stage_id, entry_stage_name } = workflowResult.rows[0]

  // =========================================================================
  // RESOLVE SERVICE CLASS
  // =========================================================================

  let resolvedServiceClassId = service_class_id

  if (!resolvedServiceClassId) {
    // Default to Standard for this org
    const scResult = await query(`
      SELECT id FROM blueprint.service_classes
      WHERE org_id = $1 AND name = 'Standard' AND is_active = true
      LIMIT 1
    `, [owner_org_id])
    resolvedServiceClassId = scResult.rows[0]?.id || null
  } else {
    // Validate provided service class belongs to this org
    const scResult = await query(
      'SELECT id FROM blueprint.service_classes WHERE id = $1 AND org_id = $2 AND is_active = true',
      [service_class_id, owner_org_id]
    )
    if (!scResult.rows.length) {
      throw new ValidationError(`Service class ${service_class_id} not found for this org`)
    }
  }

  // =========================================================================
  // VALIDATE PARENT (if provided)
  // =========================================================================

  if (parent_id) {
    const parentResult = await query(
      'SELECT id FROM runtime.work_items WHERE id = $1',
      [parent_id]
    )
    if (!parentResult.rows.length) {
      throw new ValidationError(`Parent work item ${parent_id} not found`)
    }
  }

  // =========================================================================
  // EVALUATE REQUIRED FIELDS → determine spawn_state
  // =========================================================================

  const requiredFieldsResult = await query(`
    SELECT field_key, field_label
    FROM blueprint.work_item_type_fields
    WHERE work_item_type_id = $1
      AND is_required = true
      AND is_active = true
    ORDER BY display_order ASC
  `, [work_item_type_id])

  const requiredFields = requiredFieldsResult.rows
  const missingFields  = requiredFields
    .filter(f => {
      const val = field_values[f.field_key]
      return val === undefined || val === null || val === ''
    })
    .map(f => f.field_key)

  const spawnState          = missingFields.length > 0 ? 'pending' : 'active'
  const pendingMissingFields = missingFields.length > 0 ? missingFields : null

  // =========================================================================
  // INSERT — inside a transaction
  // =========================================================================

  const client = await getClient()
  let workItem

  try {
    await client.query('BEGIN')

    const uri = generateUri(org.slug, 'work-items')
    const now = new Date()

    // Generate display key: prefix.sequence
    const keyPrefix = workItemType.key_prefix || 'WI'
    const seqResult = await client.query("SELECT nextval('runtime.work_item_seq') AS seq")
    const seqNum = parseInt(seqResult.rows[0].seq)
    const displayKey = `${keyPrefix}.${seqNum}`

    const insertResult = await client.query(`
      INSERT INTO runtime.work_items (
        uri, work_item_type_id, workflow_id, owner_org_id,
        title, description,
        current_stage_id, current_substate,
        service_class_id, spawn_state,
        parent_id,
        pending_missing_fields,
        field_values,
        sequence_number, display_key,
        due_date, is_expedited, work_nature,
        priority, tags, estimate, estimate_unit, origin, requester_id,
        entered_current_stage_at, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$24,$24)
      RETURNING *
    `, [
      uri,
      work_item_type_id,
      workflow_id,
      owner_org_id,
      title.trim(),
      description || null,
      entry_stage_id,
      resolvedServiceClassId,
      spawnState,
      parent_id || null,
      pendingMissingFields ? JSON.stringify(pendingMissingFields) : null,
      JSON.stringify(field_values),
      seqNum,
      displayKey,
      due_date || null,
      !!is_expedited,
      work_nature || 'delivery',
      priority != null ? parseInt(priority) : null,
      tags?.length ? tags : '{}',
      estimate != null ? parseFloat(estimate) : null,
      estimate_unit || 'points',
      origin || 'manual',
      requester_id || null,
      now,
    ])

    workItem = insertResult.rows[0]

    // Record creator as 'requested_by' relationship (skip for anonymous submissions)
    if (userId) {
      await client.query(`
        INSERT INTO runtime.work_item_user_relationships
          (work_item_id, user_id, relationship_type, assigned_at, is_active)
        VALUES ($1, $2, 'requested_by', $3, true)
      `, [workItem.id, userId, now])
    }

    // Emit work_item.created event (in-tx — rolls back with the insert)
    await emitEvent(client, {
      eventType: 'work_item.created',
      entityId:  workItem.id,
      entityUri: workItem.uri,
      actorId:   userId ?? null,
      payload: {
        title:               workItem.title,
        work_item_type_uri:  workItemType.uri ?? null,
        work_item_type_name: workItemType.name,
        owner_org_uri:       org.uri,
        owner_org_slug:      org.slug,
        current_stage_id:    workItem.current_stage_id,
        current_stage_name:  entry_stage_name,
        current_substate:    workItem.current_substate,
        spawn_state:         workItem.spawn_state,
        service_class:       'standard',
        sla_status:          'no_sla',
        due_date:            workItem.due_date,
        parent_id:           workItem.parent_id,
        created_at:          workItem.created_at,
        updated_at:          workItem.updated_at,
      },
    })

    await client.query('COMMIT')
    nudgeAfterCommit()

  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  // =========================================================================
  // RETURN enriched work item
  // =========================================================================

  return {
    ...workItem,
    current_stage_name:  entry_stage_name,
    work_item_type_name: workItemType.name,
    class_name:          workItemType.class_name,
    org_slug:            org.slug,
    org_uri:             org.uri,
    pending_missing_fields: pendingMissingFields,
  }
}

// =============================================================================
// UPDATE FIELDS
// =============================================================================

/**
 * Update field values on a work item.
 * Re-evaluates pending state after update.
 *
 * @param {string} workItemUri
 * @param {Object} fieldValues  - { field_key: value } — merged with existing
 * @param {number} userId
 * @returns {Promise<Object>} Updated work item
 */
export async function updateWorkItemFields(workItemUri, fieldValues, userId) {
  const workItemResult = await query(
    'SELECT * FROM runtime.work_items WHERE uri = $1',
    [workItemUri]
  )
  if (!workItemResult.rows.length) {
    throw new ValidationError('Work item not found')
  }
  const workItem = workItemResult.rows[0]

  // Merge new values with existing
  const existingFields = workItem.field_values || {}
  const mergedFields   = { ...existingFields, ...fieldValues }

  // Re-evaluate required fields
  const requiredFieldsResult = await query(`
    SELECT field_key FROM blueprint.work_item_type_fields
    WHERE work_item_type_id = $1 AND is_required = true AND is_active = true
  `, [workItem.work_item_type_id])

  const missingFields = requiredFieldsResult.rows
    .filter(f => {
      const val = mergedFields[f.field_key]
      return val === undefined || val === null || val === ''
    })
    .map(f => f.field_key)

  const newSpawnState         = missingFields.length > 0 ? 'pending' : 'active'
  const pendingMissingFields  = missingFields.length > 0 ? missingFields : null

  const now = new Date()
  const updateResult = await query(`
    UPDATE runtime.work_items SET
      field_values          = $1,
      spawn_state           = $2,
      pending_missing_fields = $3,
      updated_at            = $4
    WHERE uri = $5
    RETURNING *
  `, [
    JSON.stringify(mergedFields),
    newSpawnState,
    pendingMissingFields ? JSON.stringify(pendingMissingFields) : null,
    now,
    workItemUri,
  ])

  // Emit work_item.edited event so subscribers (search-index, audit-log) reindex.
  // This function runs in `completeWorkItem` / field-update flow — a short-lived
  // tx of its own is fine since we are outside the main transaction here.
  const evtClient = await getClient()
  try {
    await evtClient.query('BEGIN')
    await emitEvent(evtClient, {
      eventType: 'work_item.edited',
      entityId:  workItem.id,
      entityUri: workItem.uri,
      actorId:   userId ?? null,
      payload: {
        edit_group_id: randomUUID(),
        changes: [],                  // empty — this is a field-completion re-sync, not a diff
        current: workItem,
      },
    })
    await evtClient.query('COMMIT')
    nudgeAfterCommit()
  } catch (err) {
    await evtClient.query('ROLLBACK').catch(() => {})
    console.error('[workItems] Failed to emit work_item.edited after field completion:', err.message)
  } finally {
    evtClient.release()
  }

  return {
    ...updateResult.rows[0],
    pending_missing_fields: pendingMissingFields,
  }
}

// =============================================================================
// ERRORS
// =============================================================================

export class ValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ValidationError'
    this.statusCode = 422
  }
}

export default { createWorkItem, updateWorkItemFields, ValidationError }
