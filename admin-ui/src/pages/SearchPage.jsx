import { useState, useEffect, useRef } from 'react'
import { searchApi, savedFiltersApi } from '@/lib/api'
import { Search, X, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

function SnippetHighlight({ text }) {
  if (!text) return null
  const parts = text.split(/(<b>|<\/b>)/i)
  const elements = []
  let bold = false
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].toLowerCase() === '<b>') { bold = true; continue }
    if (parts[i].toLowerCase() === '</b>') { bold = false; continue }
    if (!parts[i]) continue
    elements.push(bold ? <b key={i}>{parts[i]}</b> : parts[i])
  }
  return <span>{elements}</span>
}

const STAGE_CLASSES = [
  { value: '', label: 'Any status' },
  { value: 'active', label: 'Active' },
  { value: 'queued', label: 'Queued' },
  { value: 'done', label: 'Done' },
]

export default function SearchPage({ onOpenWorkItem }) {
  const [input, setInput]               = useState('')
  const [filters, setFilters]           = useState({})
  const [rows, setRows]                 = useState([])
  const [nextBefore, setNextBefore]     = useState(null)
  const [loading, setLoading]           = useState(false)
  const [translating, setTranslating]   = useState(false)
  const [error, setError]               = useState(null)
  const [savedFilters, setSavedFilters] = useState([])
  const [fieldMeta, setFieldMeta]       = useState(null)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
    searchApi.fields().then(r => setFieldMeta(r)).catch(() => {})
    savedFiltersApi.list().then(r => setSavedFilters(r.rows || [])).catch(() => {})
  }, [])

  async function run(activeFilters, reset = true) {
    if (!Object.values(activeFilters).some(Boolean)) return
    setLoading(true)
    setError(null)
    try {
      const before = reset ? undefined : nextBefore
      const r = await searchApi.query(activeFilters, { limit: 50, include: ['snippet'], ...(before ? { before } : {}) })
      setRows(reset ? r.rows : prev => [...prev, ...r.rows])
      setNextBefore(r.next_before)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!input.trim()) return
    if (fieldMeta?.translator_available) {
      setTranslating(true)
      try {
        const tr = await searchApi.translate(input.trim())
        const { assignee_me, ...rest } = tr.filters
        const next = { ...rest }
        if (assignee_me) next.assignee_id = 'me'
        setFilters(next)
        await run(next)
      } catch (err) {
        const code = err.body?.error
        if (code === 'TRANSLATOR_UNAVAILABLE') {
          const kw = { keyword: input.trim() }
          setFilters(kw)
          await run(kw)
        } else if (code === 'TRANSLATION_FAILED') {
          setError("Couldn't understand that search — try rephrasing it.")
        } else if (code === 'PROMPT_TOO_LONG') {
          setError('Search query is too long — please shorten it.')
        } else if (code === 'RATE_LIMITED' || code === 'BUDGET_EXHAUSTED') {
          setError('Search limit reached — please try again later.')
        } else {
          setError('Search translation failed — please try again.')
        }
      } finally {
        setTranslating(false)
      }
    } else {
      const kw = { keyword: input.trim() }
      setFilters(kw)
      await run(kw)
    }
  }

  function loadSavedFilter(f) {
    setFilters(f.filter_params || {})
    setInput(f.name)
    run(f.filter_params || {})
  }

  function setFilter(key, value) {
    const next = { ...filters, [key]: value || undefined }
    if (!value) delete next[key]
    setFilters(next)
    run(next)
  }

  function clearFilters() {
    setFilters({})
    setRows([])
    setNextBefore(null)
    setInput('')
  }

  const activeFilterCount = Object.values(filters).filter(Boolean).length

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="p-4 border-b border-border space-y-3">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Describe what you're looking for…"
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <button
            type="submit"
            disabled={loading || translating || !input.trim()}
            className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {(loading || translating) && <Loader2 className="h-3 w-3 animate-spin" />}
            Search
          </button>
          {activeFilterCount > 0 && (
            <button type="button" onClick={clearFilters} className="px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </form>

        <div className="flex gap-2 items-center flex-wrap">
          <select
            value={filters.stage_class || ''}
            onChange={e => setFilter('stage_class', e.target.value)}
            className="text-xs border border-border rounded px-2 py-1 bg-background"
          >
            {STAGE_CLASSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button
            type="button"
            onClick={() => setFilter('assignee_id', filters.assignee_id === 'me' ? '' : 'me')}
            className={`text-xs px-2 py-1 rounded border ${filters.assignee_id === 'me' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
          >
            My items
          </button>
        </div>

        {savedFilters.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {savedFilters.map(f => (
              <button
                key={f.id}
                onClick={() => loadSavedFilter(f)}
                className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              >
                {f.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="p-4 text-xs text-destructive">{error}</div>
        )}
        {!loading && rows.length === 0 && activeFilterCount > 0 && (
          <div className="p-4 text-xs text-muted-foreground">No results.</div>
        )}
        {rows.map(row => (
          <button
            key={row.id}
            onClick={() => onOpenWorkItem?.(row.id)}
            className="w-full text-left px-4 py-3 border-b border-border hover:bg-black/[0.03] transition-colors"
          >
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-medium text-muted-foreground">{row.display_key}</span>
              <span className="text-sm font-medium text-foreground truncate flex-1">{row.title}</span>
              {row.stage_class && (
                <Badge variant={row.stage_class === 'done' ? 'default' : row.stage_class === 'active' ? 'blue' : 'muted'} className="shrink-0">
                  {row.status}
                </Badge>
              )}
            </div>
            {row.snippet && (
              <div className="mt-1 text-xs text-muted-foreground line-clamp-2">
                <SnippetHighlight text={row.snippet} />
              </div>
            )}
            <div className="mt-1 flex gap-2 text-xs text-muted-foreground">
              <span>{row.type_name}</span>
              {row.org_name && <span>· {row.org_name}</span>}
              {row.assignee_name && <span>· {row.assignee_name}</span>}
            </div>
          </button>
        ))}
        {nextBefore && (
          <button
            onClick={() => run(filters, false)}
            disabled={loading}
            className="w-full p-3 text-xs text-muted-foreground hover:text-foreground"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </div>
  )
}
