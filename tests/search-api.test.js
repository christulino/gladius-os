import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createAuthApi } from './helpers/auth.js'

const api = createAuthApi()

describe('Search API integration', () => {
  it('returns rows for a basic stage_class filter', async () => {
    const r = await api('/search?stage_class=triage&limit=10')
    assert.equal(r.status, 200)
    assert.ok(Array.isArray(r.data.rows))
  })

  it('returns rows for a keyword filter', async () => {
    const r = await api('/search?keyword=auth&limit=10')
    assert.equal(r.status, 200)
    assert.ok(Array.isArray(r.data.rows))
  })

  it('returns rows for a priority filter', async () => {
    const r = await api('/search?priority=1&limit=5')
    assert.equal(r.status, 200)
    assert.ok(Array.isArray(r.data.rows))
  })

  it('paginates with cursor', async () => {
    const r1 = await api('/search?stage_class=triage&limit=2')
    assert.equal(r1.status, 200)
    if (r1.data.next_before) {
      const r2 = await api(`/search?stage_class=triage&limit=2&before=${r1.data.next_before}`)
      assert.equal(r2.status, 200)
      assert.ok(Array.isArray(r2.data.rows))
    }
  })

  it('returns the field catalog', async () => {
    const r = await api('/search/fields')
    assert.equal(r.status, 200)
    assert.ok(Array.isArray(r.data.native))
    assert.equal(typeof r.data.translator_available, 'boolean')
  })

  it('returns ts_headline snippets with <b> tags when include=snippet', async () => {
    const r = await api('/search?keyword=api&limit=3&include=snippet')
    assert.equal(r.status, 200)
    if (r.data.rows.length > 0) {
      const withSnippet = r.data.rows.find(row => row.snippet)
      if (withSnippet) {
        assert.match(withSnippet.snippet, /<b>/)
      }
    }
  })
})

describe('Translate endpoint — HTTP contract', () => {
  it('rejects missing prompt field with 400 BAD_REQUEST', async () => {
    const r = await api('/search/translate', { method: 'POST', body: JSON.stringify({}) })
    assert.equal(r.status, 400)
    assert.equal(r.data.error, 'BAD_REQUEST')
  })

  it('rejects non-string prompt with 400 BAD_REQUEST', async () => {
    const r = await api('/search/translate', { method: 'POST', body: JSON.stringify({ prompt: 42 }) })
    assert.equal(r.status, 400)
    assert.equal(r.data.error, 'BAD_REQUEST')
  })

  it('rejects wrong field name (query instead of prompt) with 400', async () => {
    const r = await api('/search/translate', { method: 'POST', body: JSON.stringify({ query: 'show me bugs' }) })
    assert.equal(r.status, 400)
    assert.equal(r.data.error, 'BAD_REQUEST')
  })

  it('sends prompt field and receives { filters, model } on success', async () => {
    const fields = await api('/search/fields')
    if (!fields.data.translator_available) return
    const r = await api('/search/translate', { method: 'POST', body: JSON.stringify({ prompt: 'high priority items' }) })
    assert.equal(r.status, 200)
    assert.ok(r.data.filters !== undefined, 'response must have filters key')
    assert.ok(typeof r.data.model === 'string', 'response must have model string')
  })

  it('translate result type_name flows through to search results', async () => {
    const fields = await api('/search/fields')
    if (!fields.data.translator_available) return
    const tr = await api('/search/translate', { method: 'POST', body: JSON.stringify({ prompt: 'show me Tech Debt items' }) })
    if (tr.status !== 200) return
    const { filters } = tr.data
    if (!filters.type_name) return
    const sr = await api(`/search?type_name=${encodeURIComponent(filters.type_name)}&limit=5`)
    assert.equal(sr.status, 200)
    assert.ok(Array.isArray(sr.data.rows))
    sr.data.rows.forEach(row => assert.equal(row.type_name, filters.type_name))
  })
})
