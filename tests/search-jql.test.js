import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parse, JQLSyntaxError } from '../runtime/search/jql.js'

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
