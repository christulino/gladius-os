/**
 * runtime/search/fieldCatalog.js
 * Per-user field catalog (native + visible custom). 60s in-memory cache.
 *
 * Custom fields come from two tables joined to their org:
 *   work_item_class_fields  -> work_item_type_classes (owner_org_id)
 *   work_item_type_fields   -> work_item_types        (owner_org_id)
 * Lookup-list values are taken from blueprint.lookup_values.label.
 */

import { query } from '../../db/postgres.js'

const NATIVE_FIELDS = [
  { key: 'id',           type: 'number',  description: 'Internal ID',                  operators: ['=','!=','<','<=','>','>='] },
  { key: 'key',          type: 'string',  description: 'Display key (e.g. BUG.42)',    operators: ['=','!=','~','!~','IN','NOT IN'] },
  { key: 'title',        type: 'string',  description: 'Title',                        operators: ['=','!=','~','!~','IN','NOT IN'] },
  { key: 'description',  type: 'string',  description: 'Description',                  operators: ['~','!~','IS EMPTY'] },
  { key: 'text',         type: 'string',  description: 'Match anywhere indexed',       operators: ['~','!~'] },
  { key: 'status',       type: 'string',  description: 'Current stage name',           operators: ['=','!=','IN','NOT IN'] },
  { key: 'stage_class',  type: 'enum',    description: 'Stage classification',         operators: ['=','!=','IN','NOT IN'],
    values: ['intake','triage','queued','in_progress','waiting','review','done','cancelled'] },
  { key: 'substate',     type: 'enum',    description: 'Active/blocked/waiting',       operators: ['=','!=','IN','NOT IN'],
    values: ['active','blocked','waiting'] },
  { key: 'org',          type: 'string',  description: 'Organization slug or name',    operators: ['=','!=','IN','NOT IN'] },
  { key: 'type',         type: 'string',  description: 'Work item type',               operators: ['=','!=','IN','NOT IN'] },
  { key: 'workflow',     type: 'string',  description: 'Workflow name',                operators: ['=','!=','IN','NOT IN'] },
  { key: 'priority',     type: 'number',  description: 'Priority (1=highest)',         operators: ['=','!=','<','<=','>','>=','IN','NOT IN','IS EMPTY'] },
  { key: 'tags',         type: 'array',   description: 'Tags (any-match)',             operators: ['=','IN','IS EMPTY'] },
  { key: 'assignee',     type: 'user',    description: 'Owner (email or currentUser())', operators: ['=','!=','IN','NOT IN'] },
  { key: 'owner',        type: 'user',    description: 'Same as assignee',             operators: ['=','!=','IN','NOT IN'] },
  { key: 'requester',    type: 'user',    description: 'Original requester',           operators: ['=','!=','IN','NOT IN'] },
  { key: 'watcher',      type: 'user',    description: 'Watching the item',            operators: ['=','!=','IN','NOT IN'] },
  { key: 'is_expedited', type: 'boolean', description: 'Expedited flag',               operators: ['=','!='] },
  { key: 'work_nature',  type: 'enum',    description: 'Improvement / incident / etc', operators: ['=','!=','IN','NOT IN'] },
  { key: 'due_date',     type: 'date',    description: 'Due date',                     operators: ['=','!=','<','<=','>','>=','IS EMPTY'] },
  { key: 'created',      type: 'date',    description: 'Created at',                   operators: ['<','<=','>','>='] },
  { key: 'updated',      type: 'date',    description: 'Last update',                  operators: ['<','<=','>','>='] },
  { key: 'started',      type: 'date',    description: 'Started at',                   operators: ['<','<=','>','>=','IS EMPTY'] },
  { key: 'resolved',     type: 'date',    description: 'Resolved at',                  operators: ['<','<=','>','>=','IS EMPTY'] },
  { key: 'parent',       type: 'string',  description: 'Parent display key',           operators: ['=','!=','IS EMPTY'] },
  { key: 'origin',       type: 'enum',    description: 'How the work arrived',         operators: ['=','!=','IN','NOT IN'],
    values: ['manual','web','email','slack','api','spawn'] },
  { key: 'estimate',     type: 'number',  description: 'Estimate',                     operators: ['=','!=','<','<=','>','>=','IS EMPTY'] },
  { key: 'estimate_unit',type: 'enum',    description: 'Estimate unit',                operators: ['=','!=','IN','NOT IN'],
    values: ['points','hours','days','dollars'] },
]

const CACHE = new Map()
const TTL_MS = 60 * 1000

function cacheKey(userId, orgIds) {
  return `${userId}:${[...orgIds].sort((a,b)=>a-b).join(',')}`
}

export async function buildFieldCatalog(userCtx) {
  const key = cacheKey(userCtx.userId, userCtx.orgIds || [])
  const hit = CACHE.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.value

  const orgIds = (userCtx.orgIds && userCtx.orgIds.length) ? userCtx.orgIds : [-1]
  const { rows } = await query(`
    SELECT DISTINCT ON (f.field_key, f.org_id)
      f.field_key, f.field_type, f.field_label,
      f.lookup_list_id, f.org_id,
      o.slug AS org_slug
    FROM (
      SELECT cf.field_key, cf.field_type, cf.field_label, cf.lookup_list_id,
             c.owner_org_id AS org_id
      FROM blueprint.work_item_class_fields cf
      JOIN blueprint.work_item_type_classes c ON c.id = cf.class_id
      WHERE cf.is_active = true
      UNION ALL
      SELECT tf.field_key, tf.field_type, tf.field_label, tf.lookup_list_id,
             t.owner_org_id AS org_id
      FROM blueprint.work_item_type_fields tf
      JOIN blueprint.work_item_types t ON t.id = tf.work_item_type_id
      WHERE tf.is_active = true
    ) f
    LEFT JOIN blueprint.organizations o ON o.id = f.org_id
    WHERE f.org_id = ANY($1)
  `, [orgIds])

  const lookupListIds = [...new Set(rows.map(r => r.lookup_list_id).filter(Boolean))]
  const lookupValues = new Map()
  if (lookupListIds.length > 0) {
    const lvRes = await query(`
      SELECT list_id, label FROM blueprint.lookup_values
      WHERE list_id = ANY($1) AND is_active = true
      ORDER BY list_id, sort_order, label
    `, [lookupListIds])
    for (const lv of lvRes.rows) {
      if (!lookupValues.has(lv.list_id)) lookupValues.set(lv.list_id, [])
      lookupValues.get(lv.list_id).push(lv.label)
    }
  }

  const opsForType = {
    text: ['=','!=','~','!~','IS EMPTY','IN','NOT IN'],
    textarea: ['=','!=','~','!~','IS EMPTY'],
    url: ['=','!=','~','!~','IS EMPTY'],
    number: ['=','!=','<','<=','>','>=','IS EMPTY','IN','NOT IN'],
    boolean: ['=','!='],
    date: ['=','!=','<','<=','>','>=','IS EMPTY'],
    select: ['=','!=','IN','NOT IN','IS EMPTY'],
    multi_select: ['=','IN','IS EMPTY'],
    user: ['=','!=','IN','NOT IN'],
    org: ['=','!=','IN','NOT IN'],
  }

  const custom = rows.map(r => ({
    key: r.field_key,
    type: r.field_type,
    description: r.field_label || r.field_key,
    org_slug: r.org_slug,
    lookup_list_id: r.lookup_list_id,
    operators: opsForType[r.field_type] || ['=','!='],
    values: r.lookup_list_id ? (lookupValues.get(r.lookup_list_id) || []) : undefined,
  }))

  const compilerInput = rows.map(r => ({
    field_key: r.field_key,
    field_type: r.field_type,
    org_id: r.org_id,
    lookup_list_id: r.lookup_list_id,
  }))

  const value = { native: NATIVE_FIELDS, custom, compilerInput }
  CACHE.set(key, { value, expiresAt: Date.now() + TTL_MS })
  return value
}

export function clearFieldCatalogCache() {
  CACHE.clear()
}
