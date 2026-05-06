/**
 * runtime/search/jql.js
 * Public API: parse() returns AST; compile() lives in jqlCompiler.js.
 */

import * as parser from './jql.parser.js'

const MAX_INPUT_LENGTH = 1024 * 1024
const MAX_DEPTH = 50

export class JQLSyntaxError extends Error {
  constructor(message, { position, expected, snippet } = {}) {
    super(message)
    this.name = 'JQLSyntaxError'
    this.position = position
    this.expected = expected
    this.snippet = snippet
  }
}

export class JQLSemanticError extends Error {
  constructor(message, { field, reason, suggestion } = {}) {
    super(message)
    this.name = 'JQLSemanticError'
    this.field = field
    this.reason = reason
    this.suggestion = suggestion
  }
}

function checkDepth(node, depth = 0) {
  if (depth > MAX_DEPTH) {
    throw new JQLSyntaxError('query too deeply nested', { position: 0 })
  }
  if (!node || typeof node !== 'object') return
  if (node.left) checkDepth(node.left, depth + 1)
  if (node.right) checkDepth(node.right, depth + 1)
  if (node.expr) checkDepth(node.expr, depth + 1)
}

function checkParenDepth(input) {
  let depth = 0
  let max = 0
  let inString = null
  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (inString) {
      if (c === '\\') { i++; continue }
      if (c === inString) inString = null
      continue
    }
    if (c === '"' || c === "'") { inString = c; continue }
    if (c === '(') { depth++; if (depth > max) max = depth }
    else if (c === ')') depth--
  }
  return max
}

export function parse(input) {
  if (typeof input !== 'string') {
    throw new JQLSyntaxError('input must be a string', { position: 0 })
  }
  if (input.length > MAX_INPUT_LENGTH) {
    throw new JQLSyntaxError('query too long', { position: 0 })
  }
  if (checkParenDepth(input) > MAX_DEPTH) {
    throw new JQLSyntaxError('query too deeply nested', { position: 0 })
  }
  let ast
  try {
    ast = parser.parse(input)
  } catch (err) {
    const position = err?.location?.start?.offset ?? 0
    throw new JQLSyntaxError(err.message, {
      position,
      expected: err.expected,
      snippet: input.slice(Math.max(0, position - 10), position + 10),
    })
  }
  checkDepth(ast.expr)
  return ast
}
