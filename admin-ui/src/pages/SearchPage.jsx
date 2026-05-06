import { useState, useEffect } from 'react'
import { api, searchApi, savedFiltersApi } from '@/lib/api'
import JQLEditor from '@/components/JQLEditor'
import SavedFiltersList from '@/components/SavedFiltersList'
import SearchResultsList from '@/components/SearchResultsList'
import SavedFilterFormDrawer from '@/components/SavedFilterFormDrawer'
import { WorkItemDetail } from '@/components/WorkItemDetail'

export default function SearchPage() {
  const [query, setQuery]                       = useState('')
  const [mode, setMode]                         = useState('jql')
  const [filters, setFilters]                   = useState([])
  const [rows, setRows]                         = useState([])
  const [nextBefore, setNextBefore]             = useState(null)
  const [error, setError]                       = useState(null)
  const [running, setRunning]                   = useState(false)
  const [openItemId, setOpenItemId]             = useState(null)
  const [detailOpen, setDetailOpen]             = useState(false)
  const [fieldCatalog, setFieldCatalog]         = useState(null)
  const [translatorAvailable, setTranslatorAvailable] = useState(false)
  const [saveDrawerOpen, setSaveDrawerOpen]     = useState(false)
  const [editingFilter, setEditingFilter]       = useState(null)
  const [userOrgs, setUserOrgs]                 = useState([])

  useEffect(() => {
    savedFiltersApi.list().then(r => setFilters(r.rows || [])).catch(() => {})
    searchApi.fields().then(r => {
      setFieldCatalog(r)
      setTranslatorAvailable(r.translator_available)
    }).catch(() => {})
    api.organizations().then(r => setUserOrgs(r.rows || r || [])).catch(() => {})
  }, [])

  const run = async (overrideQuery) => {
    const qToRun = overrideQuery ?? query
    if (!qToRun.trim()) return
    setRunning(true)
    setError(null)
    try {
      let jql = qToRun
      if (mode === 'ask') {
        const tr = await searchApi.translate(qToRun)
        jql = tr.jql
        setQuery(jql)
        setMode('jql')
      }
      const r = await searchApi.query(jql, { limit: 50, include: ['snippet'] })
      setRows(r.rows)
      setNextBefore(r.next_before)
    } catch (err) {
      const body = err.body || {}
      let msg = body.message || err.message || String(err)
      if (body.position !== undefined && body.snippet) {
        msg += ` (near "${body.snippet}" at position ${body.position})`
      }
      if (body.suggestion) {
        msg += ` — did you mean "${body.suggestion}"?`
      }
      setError(msg)
      setRows([])
      setNextBefore(null)
    } finally {
      setRunning(false)
    }
  }

  const loadMore = async () => {
    if (!nextBefore) return
    try {
      const r = await searchApi.query(query, { before: nextBefore, limit: 50, include: ['snippet'] })
      setRows([...rows, ...r.rows])
      setNextBefore(r.next_before)
    } catch {
      // Ignore: keep what we have.
    }
  }

  const selectFilter = (f) => {
    setQuery(f.jql)
    setMode('jql')
    setEditingFilter(f)
    run(f.jql)
  }

  const handleDelete = async (f) => {
    await savedFiltersApi.remove(f.id)
    setFilters(prev => prev.filter(p => p.id !== f.id))
    if (editingFilter?.id === f.id) setEditingFilter(null)
  }

  const handleEdit = (f) => {
    setEditingFilter(f)
    setQuery(f.jql)
    setSaveDrawerOpen(true)
  }

  const onSaved = (saved) => {
    setFilters(prev => {
      const exists = prev.find(p => p.id === saved.id)
      return exists ? prev.map(p => p.id === saved.id ? saved : p) : [...prev, saved]
    })
    setEditingFilter(saved)
  }

  const openItem = (id) => { setOpenItemId(id); setDetailOpen(true) }

  return (
    <div className="flex h-full">
      <SavedFiltersList
        filters={filters}
        onSelect={selectFilter}
        onNew={() => { setEditingFilter(null); setSaveDrawerOpen(true) }}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />
      <div className="flex-1 flex flex-col">
        <div className="p-3 border-b border-border">
          <JQLEditor
            value={query}
            onChange={setQuery}
            onRun={() => run()}
            mode={mode}
            onModeChange={setMode}
            fieldCatalog={fieldCatalog}
            translatorAvailable={translatorAvailable}
            error={error}
          />
        </div>
        <div className="flex items-center justify-between p-3 border-b border-border">
          <div className="text-xs text-foreground/60">
            {rows.length} result{rows.length === 1 ? '' : 's'}{nextBefore ? '+' : ''}
          </div>
          <button
            onClick={() => { setEditingFilter(null); setSaveDrawerOpen(true) }}
            disabled={!query.trim()}
            className="text-xs px-3 py-1 rounded border border-border hover:bg-black/[0.03] disabled:opacity-50"
          >Save filter</button>
        </div>
        <div className="flex-1 overflow-auto">
          {running && <div className="p-6 text-xs">Running…</div>}
          {!running && <SearchResultsList rows={rows} onOpen={openItem} hasMore={!!nextBefore} onLoadMore={loadMore} />}
        </div>
      </div>
      <WorkItemDetail
        workItemId={openItemId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
      <SavedFilterFormDrawer
        open={saveDrawerOpen}
        onOpenChange={setSaveDrawerOpen}
        currentJql={query}
        editing={editingFilter}
        userOrgs={userOrgs}
        onSaved={onSaved}
      />
    </div>
  )
}
