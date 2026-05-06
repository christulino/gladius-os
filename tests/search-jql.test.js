import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parse, JQLSyntaxError, JQLSemanticError } from '../runtime/search/jql.js'
import { compile } from '../runtime/search/jqlCompiler.js'

describe('JQL parser', () => {
  it('parses a simple equality predicate', () => {
    const ast = parse('priority = 2')
    assert.equal(ast.type, 'query')
    assert.equal(ast.expr.type, 'predicate')
    assert.equal(ast.expr.field, 'priority')
    assert.equal(ast.expr.op, '=')
    assert.equal(ast.expr.value.value, 2)
  })

  it('parses string literals with double and single quotes', () => {
    assert.equal(parse('title = "foo bar"').expr.value.value, 'foo bar')
    assert.equal(parse("title = 'foo bar'").expr.value.value, 'foo bar')
  })

  it('parses AND', () => {
    const ast = parse('priority = 1 AND status = "Doing"')
    assert.equal(ast.expr.type, 'and')
  })

  it('parses OR', () => {
    const ast = parse('priority = 1 OR priority = 2')
    assert.equal(ast.expr.type, 'or')
  })

  it('respects parenthesized precedence', () => {
    const ast = parse('(priority = 1 OR priority = 2) AND status = "Doing"')
    assert.equal(ast.expr.type, 'and')
    assert.equal(ast.expr.left.type, 'or')
  })

  it('parses NOT', () => {
    const ast = parse('NOT priority = 1')
    assert.equal(ast.expr.type, 'not')
  })

  it('parses IN list', () => {
    const ast = parse('status IN ("Doing", "Review", "Done")')
    assert.equal(ast.expr.type, 'in_list')
    assert.equal(ast.expr.values.length, 3)
    assert.equal(ast.expr.negated, false)
  })

  it('parses NOT IN list', () => {
    const ast = parse('priority NOT IN (1, 2)')
    assert.equal(ast.expr.type, 'in_list')
    assert.equal(ast.expr.negated, true)
  })

  it('parses IS EMPTY and IS NOT EMPTY', () => {
    assert.equal(parse('resolved IS EMPTY').expr.negated, false)
    assert.equal(parse('resolved IS NOT EMPTY').expr.negated, true)
  })

  it('parses ~ and !~ for text matching', () => {
    assert.equal(parse('text ~ "saml"').expr.type, 'text_match')
    assert.equal(parse('text !~ "saml"').expr.negated, true)
  })

  it('parses function calls', () => {
    const ast = parse('assignee = currentUser()')
    assert.equal(ast.expr.value.type, 'fn_call')
    assert.equal(ast.expr.value.name, 'currentUser')
    assert.deepEqual(ast.expr.value.args, [])
  })

  it('parses function calls with arguments', () => {
    const ast = parse('created > daysAgo(30)')
    assert.equal(ast.expr.value.type, 'fn_call')
    assert.equal(ast.expr.value.args[0].value, 30)
  })

  it('parses ORDER BY', () => {
    const ast = parse('priority = 1 ORDER BY due_date ASC')
    assert.equal(ast.sort[0].field, 'due_date')
    assert.equal(ast.sort[0].direction, 'ASC')
  })

  it('parses comparison operators', () => {
    for (const op of ['=', '!=', '<', '<=', '>', '>=']) {
      const ast = parse(`priority ${op} 2`)
      assert.equal(ast.expr.op, op)
    }
  })

  it('throws JQLSyntaxError on unterminated string', () => {
    assert.throws(() => parse('text ~ "unclosed'), JQLSyntaxError)
  })

  it('throws JQLSyntaxError on bad operator', () => {
    assert.throws(() => parse('priority => 2'), JQLSyntaxError)
  })

  it('throws JQLSyntaxError on missing right side', () => {
    assert.throws(() => parse('priority >='), JQLSyntaxError)
  })

  it('attaches position to syntax errors', () => {
    try { parse('priority = '); assert.fail('should have thrown') }
    catch (err) {
      assert.ok(err instanceof JQLSyntaxError)
      assert.equal(typeof err.position, 'number')
    }
  })

  it('rejects oversized input (>1MB)', () => {
    const big = 'priority = 1' + ' AND priority = 1'.repeat(70000)
    assert.throws(() => parse(big), /too long|JQLSyntaxError/)
  })

  it('rejects deeply nested expressions (>50 levels)', () => {
    const deep = '('.repeat(60) + 'priority = 1' + ')'.repeat(60)
    assert.throws(() => parse(deep), JQLSyntaxError)
  })
})

const ctx = (orgIds = [1], userId = 1, opts = {}) => ({
  userId, orgIds,
  isAdmin: opts.isAdmin || false,
  doneRetentionDays: opts.doneRetentionDays || 90,
  customFields: opts.customFields || [],
})

describe('JQL compiler — native fields', () => {
  it('compiles priority = 2', () => {
    const { sql, params } = compile(parse('priority = 2'), ctx())
    assert.match(sql, /wi\.priority = \$\d+/)
    assert.ok(params.includes(2))
  })

  it('compiles AND', () => {
    const { sql } = compile(parse('priority = 2 AND status = "Doing"'), ctx())
    assert.match(sql, /AND/)
  })

  it('compiles OR', () => {
    const { sql } = compile(parse('priority = 1 OR priority = 2'), ctx())
    assert.match(sql, /OR/)
  })

  it('compiles IN list with parameter binding', () => {
    const { sql, params } = compile(parse('status IN ("A", "B")'), ctx())
    assert.match(sql, /IN \(/)
    assert.ok(params.includes('A'))
  })

  it('compiles IS EMPTY for nullable native field', () => {
    const { sql } = compile(parse('resolved IS EMPTY'), ctx())
    assert.match(sql, /resolved_at IS NULL/)
  })

  it('compiles IS NOT EMPTY', () => {
    const { sql } = compile(parse('resolved IS NOT EMPTY'), ctx())
    assert.match(sql, /resolved_at IS NOT NULL/)
  })

  it('compiles currentUser() to userId binding', () => {
    const { params } = compile(parse('assignee = currentUser()'), ctx([1], 42))
    assert.ok(params.includes(42))
  })

  it('compiles daysAgo(n) to a TIMESTAMP', () => {
    const { sql } = compile(parse('created > daysAgo(7)'), ctx())
    assert.match(sql, /created_at > NOW\(\) - INTERVAL/)
  })

  it('compiles tags = "p0" as ANY-match on array', () => {
    const { sql } = compile(parse('tags = "p0"'), ctx())
    assert.match(sql, /= ANY\(wi\.tags\)/)
  })

  it('compiles text ~ "foo" as plainto_tsquery', () => {
    const { sql } = compile(parse('text ~ "foo"'), ctx())
    assert.match(sql, /search_doc @@ plainto_tsquery/)
  })

  it('compiles ORDER BY', () => {
    const { sql } = compile(parse('priority = 1 ORDER BY due_date DESC'), ctx())
    assert.match(sql, /ORDER BY .*due_date DESC/)
  })

  it('always appends org-visibility predicate', () => {
    const { sql, params } = compile(parse('priority = 1'), ctx([1, 2, 5]))
    assert.match(sql, /owner_org_id = ANY/)
    assert.ok(params.some(p => Array.isArray(p) && p.includes(5)))
  })

  it('throws JQLSemanticError on unknown field', () => {
    assert.throws(
      () => compile(parse('xyz = 1'), ctx()),
      err => err instanceof JQLSemanticError && err.reason === 'unknown_field'
    )
  })

  it('throws JQLSemanticError on wrong operator for type', () => {
    assert.throws(
      () => compile(parse('priority ~ "high"'), ctx()),
      err => err instanceof JQLSemanticError
    )
  })

  it('throws on empty IN list', () => {
    assert.throws(() => compile({ type: 'query', expr: { type: 'in_list', field: 'priority', values: [], negated: false }, sort: [] }, ctx()),
      err => err instanceof JQLSemanticError && err.reason === 'empty_in_list')
  })
})

describe('JQL compiler — done retention', () => {
  it('appends retention filter when no resolved-state predicate is present', () => {
    const { sql } = compile(parse('priority = 1'), ctx([1], 1, { doneRetentionDays: 30 }))
    assert.match(sql, /resolved_at IS NULL OR resolved_at >/)
  })

  it('omits retention filter when query references resolved', () => {
    const { sql } = compile(parse('resolved > daysAgo(180)'), ctx())
    assert.equal(sql.match(/resolved_at IS NULL OR/g), null)
  })

  it('omits retention filter when querying by id', () => {
    const { sql } = compile(parse('id = 42'), ctx())
    assert.equal(sql.match(/resolved_at IS NULL OR/g), null)
  })

  it('omits retention filter when stage_class includes done', () => {
    const { sql } = compile(parse('stage_class = "done"'), ctx())
    assert.equal(sql.match(/resolved_at IS NULL OR/g), null)
  })
})

describe('JQL compiler — custom fields', () => {
  const customCtx = ctx([1], 1, {
    customFields: [
      { field_key: 'severity', field_type: 'select', org_id: 1, lookup_list_id: 5 },
      { field_key: 'notes',    field_type: 'textarea', org_id: 1 },
    ],
  })

  it('compiles a custom select field via field_values JSONB', () => {
    const { sql } = compile(parse('severity = "P1"'), customCtx)
    assert.match(sql, /field_values/)
  })

  it('rejects ~ on a number-typed custom field', () => {
    const ctxNum = ctx([1], 1, {
      customFields: [{ field_key: 'cost', field_type: 'number', org_id: 1 }],
    })
    assert.throws(() => compile(parse('cost ~ "high"'), ctxNum), JQLSemanticError)
  })

  it('rejects sort on un-indexed text custom field', () => {
    assert.throws(() => compile(parse('priority = 1 ORDER BY notes'), customCtx),
      err => err instanceof JQLSemanticError && err.reason === 'unindexed_sort')
  })
})

describe('JQL compiler — adversarial', () => {
  it('parameterizes string literals (no SQL injection)', () => {
    const { sql, params } = compile(parse(`title = "'; DROP TABLE users; --"`), ctx())
    assert.equal(sql.includes('DROP TABLE'), false)
    assert.ok(params.some(p => typeof p === 'string' && p.includes('DROP TABLE')))
  })
})
