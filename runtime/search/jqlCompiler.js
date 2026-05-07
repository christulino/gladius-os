/**
 * runtime/search/jqlCompiler.js
 * AST → parameterized SQL with org-visibility scope and done-retention default.
 */

import { JQLSemanticError } from './jql.js'

const NATIVE = {
  id:            { col: 'wi.id',                    type: 'number' },
  key:           { col: 'wi.display_key',           type: 'string' },
  title:         { col: 'wi.title',                 type: 'string', textIndexed: true },
  description:   { col: 'wi.description',           type: 'string', textIndexed: true },
  text:          { col: 'wis.search_doc',           type: 'tsvector', textIndexed: true },
  status:        { col: 's.name',                   type: 'string' },
  stage_class:   { col: 's.stage_class',            type: 'enum' },
  substate:      { col: 'wi.current_substate',      type: 'enum' },
  org:           { col: 'o.slug',                   type: 'string' },
  type:          { col: 'wit.name',                 type: 'string' },
  workflow:      { col: 'w.name',                   type: 'string' },
  priority:      { col: 'wi.priority',              type: 'number' },
  tags:          { col: 'wi.tags',                  type: 'array' },
  assignee:      { col: 'rel_owns.user_id',         type: 'user' },
  owner:         { col: 'rel_owns.user_id',         type: 'user' },
  requester:     { col: 'wi.requester_id',          type: 'user' },
  watcher:       { col: 'rel_watch.user_id',        type: 'user' },
  is_expedited:  { col: 'wi.is_expedited',          type: 'boolean' },
  work_nature:   { col: 'wi.work_nature',           type: 'enum' },
  due_date:      { col: 'wi.due_date',              type: 'date' },
  created:       { col: 'wi.created_at',            type: 'date' },
  updated:       { col: 'wi.updated_at',            type: 'date' },
  started:       { col: 'wi.started_at',            type: 'date' },
  resolved:      { col: 'wi.resolved_at',           type: 'date' },
  parent:        { col: '(SELECT display_key FROM runtime.work_items WHERE id = wi.parent_id)', type: 'string' },
  origin:        { col: 'wi.origin',                type: 'enum' },
  estimate:      { col: 'wi.estimate',              type: 'number' },
  estimate_unit: { col: 'wi.estimate_unit',         type: 'enum' },
}

const OPS_BY_TYPE = {
  string:   ['=', '!=', '~', '!~'],
  number:   ['=', '!=', '<', '<=', '>', '>='],
  date:     ['=', '!=', '<', '<=', '>', '>='],
  boolean:  ['=', '!='],
  enum:     ['=', '!='],
  array:    ['='],
  user:     ['=', '!='],
  tsvector: ['~', '!~'],
}

const RETENTION_TRIGGER_FIELDS = new Set(['resolved', 'id', 'key'])

function evalFunction(name, args, ctx, params) {
  switch (name) {
    case 'currentUser':
      params.push(ctx.userId)
      return `$${params.length}`
    case 'now':         return 'NOW()'
    case 'today':       return "DATE_TRUNC('day', NOW())"
    case 'startOfDay':  return "DATE_TRUNC('day', NOW())"
    case 'endOfDay':    return "DATE_TRUNC('day', NOW()) + INTERVAL '1 day'"
    case 'startOfWeek': return "DATE_TRUNC('week', NOW())"
    case 'endOfWeek':   return "DATE_TRUNC('week', NOW()) + INTERVAL '1 week'"
    case 'startOfMonth':return "DATE_TRUNC('month', NOW())"
    case 'endOfMonth':  return "DATE_TRUNC('month', NOW()) + INTERVAL '1 month'"
    case 'daysAgo': {
      if (args.length !== 1 || args[0].dataType !== 'number') {
        throw new JQLSemanticError('daysAgo() requires a number argument', { reason: 'bad_function_arg' })
      }
      params.push(args[0].value)
      return `NOW() - INTERVAL '1 day' * $${params.length}`
    }
    case 'daysFromNow': {
      if (args.length !== 1 || args[0].dataType !== 'number') {
        throw new JQLSemanticError('daysFromNow() requires a number argument', { reason: 'bad_function_arg' })
      }
      params.push(args[0].value)
      return `NOW() + INTERVAL '1 day' * $${params.length}`
    }
    default:
      throw new JQLSemanticError(`unknown function '${name}'`, { reason: 'unknown_function' })
  }
}

function emitValue(value, ctx, params) {
  if (value.type === 'fn_call') return evalFunction(value.name, value.args, ctx, params)
  if (value.type === 'lit') {
    params.push(value.value)
    return `$${params.length}`
  }
  throw new JQLSemanticError('unsupported value', { reason: 'bad_value' })
}

function levenshtein(a, b) {
  if (a === b) return 0
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
  }
  return dp[m][n]
}

function nearestField(name, ctx) {
  const candidates = [...Object.keys(NATIVE), ...ctx.customFields.map(f => f.field_key)]
  let best = null, bestDist = Infinity
  for (const c of candidates) {
    const d = levenshtein(name, c)
    if (d < bestDist && d <= 2) { bestDist = d; best = c }
  }
  return best
}

function resolveField(name, ctx) {
  if (NATIVE[name]) return { kind: 'native', meta: NATIVE[name] }
  const matches = ctx.customFields.filter(f => f.field_key === name)
  if (matches.length === 0) {
    throw new JQLSemanticError(`unknown field '${name}'`, {
      field: name, reason: 'unknown_field', suggestion: nearestField(name, ctx),
    })
  }
  return { kind: 'custom', defs: matches }
}

function checkOp(meta, op, fieldName) {
  const allowed = OPS_BY_TYPE[meta.type] || []
  if (!allowed.includes(op)) {
    throw new JQLSemanticError(
      `operator '${op}' not valid on ${meta.type} field '${fieldName}'`,
      { field: fieldName, reason: 'wrong_operator_for_type' }
    )
  }
}

function referencesAny(node, fieldNames) {
  if (!node || typeof node !== 'object') return false
  if (node.field && fieldNames.has(node.field)) return true
  if (node.field === 'stage_class' && node.value?.value === 'done') return true
  if (node.values?.some(v => v.value === 'done')) return true
  if (node.left)  return referencesAny(node.left, fieldNames) || referencesAny(node.right, fieldNames)
  if (node.expr)  return referencesAny(node.expr, fieldNames)
  return false
}

function emitPredicate(node, ctx, params) {
  const { field, op, value } = node
  const resolved = resolveField(field, ctx)
  if (resolved.kind === 'native') {
    const m = resolved.meta
    checkOp(m, op, field)
    if (m.type === 'array') {
      const v = emitValue(value, ctx, params)
      return `${v} = ANY(${m.col})`
    }
    const v = emitValue(value, ctx, params)
    return `${m.col} ${op} ${v}`
  }
  return emitCustomFieldPredicate(field, resolved.defs, op, value, ctx, params)
}

function emitCustomFieldPredicate(fieldKey, defs, op, value, ctx, params) {
  const ft = defs[0].field_type
  const opMap = {
    text: 'string', textarea: 'string', url: 'string',
    number: 'number', boolean: 'boolean', date: 'date',
    select: 'enum', multi_select: 'array', user: 'user', org: 'user',
  }
  const sqlType = opMap[ft] || 'string'
  checkOp({ type: sqlType }, op, fieldKey)

  params.push(fieldKey)
  const keyParam = `$${params.length}`
  const v = emitValue(value, ctx, params)

  if (ft === 'multi_select') {
    return `EXISTS (SELECT 1 FROM jsonb_array_elements_text(wi.field_values->${keyParam}) AS x(v) WHERE x.v = ${v})`
  }
  if (ft === 'number' || ft === 'date') {
    const cast = ft === 'number' ? 'numeric' : 'timestamptz'
    return `(wi.field_values->>${keyParam})::${cast} ${op} ${v}`
  }
  if (ft === 'boolean') {
    return `(wi.field_values->>${keyParam})::boolean ${op} ${v}`
  }
  return `wi.field_values->>${keyParam} ${op} ${v}`
}

function emitInList(node, ctx, params) {
  if (node.values.length === 0) {
    throw new JQLSemanticError('IN list cannot be empty', {
      field: node.field, reason: 'empty_in_list',
    })
  }
  const resolved = resolveField(node.field, ctx)
  const placeholders = node.values.map(v => emitValue(v, ctx, params)).join(', ')
  if (resolved.kind === 'native') {
    if (resolved.meta.type === 'array') {
      return `${resolved.meta.col} && ARRAY[${placeholders}]`
    }
    const sql = `${resolved.meta.col} IN (${placeholders})`
    return node.negated ? `NOT (${sql})` : sql
  }
  params.push(node.field)
  const keyParam = `$${params.length}`
  const sql = `wi.field_values->>${keyParam} IN (${placeholders})`
  return node.negated ? `NOT (${sql})` : sql
}

function emitIsEmpty(node, ctx) {
  const resolved = resolveField(node.field, ctx)
  if (resolved.kind === 'native') {
    const col = resolved.meta.col
    return node.negated ? `${col} IS NOT NULL` : `${col} IS NULL`
  }
  return node.negated
    ? `wi.field_values ? '${node.field}' AND wi.field_values->>'${node.field}' IS NOT NULL`
    : `(wi.field_values IS NULL OR NOT (wi.field_values ? '${node.field}') OR wi.field_values->>'${node.field}' IS NULL)`
}

export function buildPrefixTsquery(text) {
  const tokens = String(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (tokens.length === 0) return null
  return tokens.map(t => t + ':*').join(' & ')
}

function emitTextMatch(node, ctx, params) {
  const resolved = resolveField(node.field, ctx)
  const isNativeIndexed = resolved.kind === 'native' && resolved.meta.textIndexed
  const isCustomText = resolved.kind === 'custom' &&
    ['text','textarea','url'].includes(resolved.defs[0].field_type)
  if (!isNativeIndexed && !isCustomText) {
    throw new JQLSemanticError(
      `~ not valid on field '${node.field}'`,
      { field: node.field, reason: 'wrong_operator_for_type' }
    )
  }
  const tsquery = buildPrefixTsquery(node.value.value)
  if (tsquery === null) return node.negated ? 'TRUE' : 'FALSE'
  params.push(tsquery)
  const v = `$${params.length}`
  const clause = `wis.search_doc @@ to_tsquery('english', ${v})`
  return node.negated ? `NOT (${clause})` : clause
}

function emitExpr(node, ctx, params) {
  if (!node) return 'TRUE'
  switch (node.type) {
    case 'and': return `(${emitExpr(node.left, ctx, params)} AND ${emitExpr(node.right, ctx, params)})`
    case 'or':  return `(${emitExpr(node.left, ctx, params)} OR ${emitExpr(node.right, ctx, params)})`
    case 'not': return `NOT (${emitExpr(node.expr, ctx, params)})`
    case 'predicate': return emitPredicate(node, ctx, params)
    case 'in_list':   return emitInList(node, ctx, params)
    case 'is_empty':  return emitIsEmpty(node, ctx)
    case 'text_match':return emitTextMatch(node, ctx, params)
    default: throw new JQLSemanticError(`unsupported AST node ${node.type}`, { reason: 'bad_ast' })
  }
}

function emitSort(sort, ctx) {
  if (!sort || sort.length === 0) {
    return 'ORDER BY wi.priority DESC NULLS LAST, wi.updated_at DESC'
  }
  const parts = sort.map(s => {
    const r = resolveField(s.field, ctx)
    if (r.kind === 'custom' && ['text', 'textarea', 'url'].includes(r.defs[0].field_type)) {
      throw new JQLSemanticError(
        `cannot sort on text custom field '${s.field}' (not indexed)`,
        { field: s.field, reason: 'unindexed_sort' }
      )
    }
    const col = r.kind === 'native' ? r.meta.col : `wi.field_values->>'${s.field}'`
    return `${col} ${s.direction}`
  })
  return `ORDER BY ${parts.join(', ')}`
}

function emitRetention(ast, ctx, params) {
  if (referencesAny(ast.expr, RETENTION_TRIGGER_FIELDS)) return null
  params.push(ctx.doneRetentionDays)
  return `(wi.resolved_at IS NULL OR wi.resolved_at > NOW() - INTERVAL '1 day' * $${params.length})`
}

function needsSearchDoc(ast) {
  const json = JSON.stringify(ast)
  return /text_match|"text"/i.test(json)
}

export function compile(ast, userCtx) {
  const ctx = {
    userId: userCtx.userId,
    orgIds: userCtx.orgIds || [],
    isAdmin: !!userCtx.isAdmin,
    doneRetentionDays: userCtx.doneRetentionDays ?? 90,
    customFields: userCtx.customFields || [],
  }
  const params = []
  const userExpr = ast.expr ? emitExpr(ast.expr, ctx, params) : 'TRUE'
  const retention = emitRetention(ast, ctx, params)

  // Admin bypass: instance admins see everything. Regular users are scoped to
  // the orgs they're a member of via blueprint.org_memberships.
  let accessClause
  if (ctx.isAdmin) {
    accessClause = 'TRUE'
  } else {
    params.push(ctx.orgIds)
    accessClause = `wi.owner_org_id = ANY($${params.length})`
  }

  const searchJoin = needsSearchDoc(ast)
    ? 'LEFT JOIN runtime.work_item_search wis ON wis.work_item_id = wi.id'
    : ''

  const where = [userExpr, accessClause]
  if (retention) where.push(retention)

  const sql = `
    SELECT wi.id, wi.display_key, wi.title, wi.priority, wi.tags,
           wi.due_date, wi.is_expedited, wi.updated_at, wi.resolved_at, wi.created_at,
           wi.owner_org_id,
           s.name AS status, s.stage_class,
           o.slug AS org_slug, o.name AS org_name,
           wit.name AS type_name, wit.icon AS type_icon, wit.color AS type_color,
           wi.current_substate AS substate,
           rel_owns.user_id AS owner_user_id,
           u.email AS assignee_email, u.display_name AS assignee_name
    FROM runtime.work_items wi
    JOIN blueprint.stages s ON s.id = wi.current_stage_id
    JOIN blueprint.organizations o ON o.id = wi.owner_org_id
    JOIN blueprint.work_item_types wit ON wit.id = wi.work_item_type_id
    JOIN blueprint.workflows w ON w.id = wi.workflow_id
    LEFT JOIN runtime.work_item_user_relationships rel_owns
      ON rel_owns.work_item_id = wi.id AND rel_owns.relationship_type = 'owns'
    LEFT JOIN runtime.work_item_user_relationships rel_watch
      ON rel_watch.work_item_id = wi.id AND rel_watch.relationship_type = 'watching'
    LEFT JOIN blueprint.users u ON u.id = rel_owns.user_id
    ${searchJoin}
    WHERE ${where.join(' AND ')}
    ${emitSort(ast.sort, ctx)}
  `.trim()

  return { sql, params }
}
