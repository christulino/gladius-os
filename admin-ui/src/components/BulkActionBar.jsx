import { useState } from 'react'
import { api } from '@/lib/api'

const RELATIONSHIP_TYPES = [
  { value: 'owns',       label: 'Owner' },
  { value: 'working_on', label: 'Working On' },
  { value: 'watching',   label: 'Watching' },
  { value: 'reviewing',  label: 'Reviewing' },
]

export function BulkActionBar({ selectedIds, stages, users, onDone, onClear }) {
  const [mode, setMode] = useState(null)  // 'transition' | 'assign' | null
  const [toStageId, setToStageId] = useState('')
  const [userId, setUserId] = useState('')
  const [relType, setRelType] = useState('owns')
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState(null)

  const count = selectedIds.size

  async function runTransition() {
    if (!toStageId) return
    setRunning(true)
    setResults(null)
    try {
      const data = await api.bulkTransition([...selectedIds], parseInt(toStageId))
      setResults(data)
      if (data.failed_count === 0) setTimeout(() => { setResults(null); setMode(null); onDone() }, 1200)
    } catch (err) {
      setResults({ error: err.message })
    } finally {
      setRunning(false)
    }
  }

  async function runAssign() {
    if (!userId) return
    setRunning(true)
    setResults(null)
    try {
      const data = await api.bulkAssign([...selectedIds], parseInt(userId), relType)
      setResults(data)
      if (data.failed_count === 0) setTimeout(() => { setResults(null); setMode(null); onDone() }, 1200)
    } catch (err) {
      setResults({ error: err.message })
    } finally {
      setRunning(false)
    }
  }

  function reset() {
    setMode(null)
    setResults(null)
    setToStageId('')
    setUserId('')
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-card shadow-lg px-4 py-2 flex items-center gap-3 flex-wrap" style={{ marginLeft: 200 }}>
      <span className="text-xs font-medium text-primary">{count} selected</span>

      {!mode && !results && (
        <>
          <button
            onClick={() => { setMode('transition'); setResults(null) }}
            className="px-2.5 py-1 text-xs rounded border border-border bg-background hover:border-primary/50 transition-colors"
          >
            Transition to...
          </button>
          <button
            onClick={() => { setMode('assign'); setResults(null) }}
            className="px-2.5 py-1 text-xs rounded border border-border bg-background hover:border-primary/50 transition-colors"
          >
            Assign to...
          </button>
        </>
      )}

      {mode === 'transition' && (
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={toStageId}
            onChange={e => setToStageId(e.target.value)}
            className="bg-background border border-border rounded px-2 py-1 text-xs"
          >
            <option value="">Pick a stage...</option>
            {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button
            onClick={runTransition}
            disabled={!toStageId || running}
            className="px-2.5 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {running ? 'Moving...' : 'Move'}
          </button>
          <button onClick={reset} className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
        </div>
      )}

      {mode === 'assign' && (
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={relType}
            onChange={e => setRelType(e.target.value)}
            className="bg-background border border-border rounded px-2 py-1 text-xs"
          >
            {RELATIONSHIP_TYPES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <select
            value={userId}
            onChange={e => setUserId(e.target.value)}
            className="bg-background border border-border rounded px-2 py-1 text-xs"
          >
            <option value="">Pick a user...</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
          </select>
          <button
            onClick={runAssign}
            disabled={!userId || running}
            className="px-2.5 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {running ? 'Assigning...' : 'Assign'}
          </button>
          <button onClick={reset} className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
        </div>
      )}

      {results && !results.error && (
        <div className="flex items-center gap-3">
          {results.succeeded_count > 0 && (
            <span className="text-xs text-green-700">{results.succeeded_count} succeeded</span>
          )}
          {results.failed_count > 0 && (
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-destructive">{results.failed_count} failed</span>
              {results.results.filter(r => !r.success).map(r => (
                <span key={r.id} className="text-xs text-muted-foreground">#{r.id}: {r.error}</span>
              ))}
            </div>
          )}
          {results.failed_count > 0 && (
            <button onClick={reset} className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground">Dismiss</button>
          )}
        </div>
      )}

      {results?.error && (
        <span className="text-xs text-destructive">{results.error}</span>
      )}

      <button
        onClick={() => { reset(); onClear() }}
        className="ml-auto px-2.5 py-1 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
      >
        Clear selection
      </button>
    </div>
  )
}
