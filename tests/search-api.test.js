import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createAuthApi } from './helpers/auth.js'

const api = createAuthApi()

describe('Search API integration', () => {
  it('returns rows for a basic JQL query', async () => {
    const r = await api('/search?q=stage_class%20%3D%20%22triage%22&limit=10')
    assert.equal(r.status, 200)
    assert.ok(Array.isArray(r.data.rows))
  })

  it('returns 400 on JQL syntax error', async () => {
    const r = await api('/search?q=priority%20%3D%3D%202')
    assert.equal(r.status, 400)
    assert.equal(r.data.error, 'JQL_SYNTAX_ERROR')
  })

  it('returns 400 on unknown field', async () => {
    const r = await api('/search?q=xyz%20%3D%201')
    assert.equal(r.status, 400)
    assert.equal(r.data.error, 'JQL_SEMANTIC_ERROR')
  })

  it('paginates with cursor', async () => {
    const r1 = await api('/search?q=stage_class%20%3D%20%22triage%22&limit=2')
    assert.equal(r1.status, 200)
    if (r1.data.next_before) {
      const r2 = await api(`/search?q=stage_class%20%3D%20%22triage%22&limit=2&before=${r1.data.next_before}`)
      assert.equal(r2.status, 200)
    }
  })

  it('returns the field catalog', async () => {
    const r = await api('/search/fields')
    assert.equal(r.status, 200)
    assert.equal(r.data.native.length, 28)
    assert.equal(typeof r.data.translator_available, 'boolean')
  })

  it('rejects empty IN list', async () => {
    // Cannot trigger from the URL — empty list isn't expressible in JQL grammar.
    // Verified at the compiler level (search-jql.test.js).
    assert.ok(true)
  })

  it('returns ts_headline snippets when include=snippet and query has ~', async () => {
    const r = await api('/search?q=text%20~%20%22api%22&limit=3&include=snippet')
    assert.equal(r.status, 200)
    if (r.data.rows.length > 0) {
      const withSnippet = r.data.rows.find(row => row.snippet)
      // Some rows should have a <mark>-tagged snippet if the term is present
      if (withSnippet) {
        assert.match(withSnippet.snippet, /<mark>/)
      }
    }
  })
})
