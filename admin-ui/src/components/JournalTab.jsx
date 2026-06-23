import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import { ContextEntryCard } from './ContextEntryCard'
import { Button } from '@/components/ui/button'

const KNOWN_TYPES = ['nfr', 'discovery', 'acceptance', 'design', 'decision', 'note', 'test-plan', 'playbook']

function AddEntryForm({ workItemId, onAdded, onCancel }) {
  const [type, setType]             = useState('note')
  const [title, setTitle]           = useState('')
  const [content, setContent]       = useState('')
  const [visibility, setVisibility] = useState('item')
  const [saving, setSaving]         = useState(false)

  async function submit() {
    if (!content.trim()) return
    setSaving(true)
    try {
      const entry = await api.createContextEntry(workItemId, {
        type, title: title || undefined, content, visibility,
      })
      onAdded(entry)
    } finally { setSaving(false) }
  }

  return (
    <div className="rounded-md border border-primary bg-card overflow-hidden">
      <div className="px-3 py-2 border-b border-border flex items-center gap-2 bg-muted/30">
        <select value={type} onChange={e => setType(e.target.value)}
          className="text-xs border border-border rounded px-1 py-0.5 bg-background">
          {KNOWN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input value={title} onChange={e => setTitle(e.target.value)}
          placeholder="Title (optional)"
          className="flex-1 text-xs border border-border rounded px-2 py-0.5 bg-background" />
        <select value={visibility} onChange={e => setVisibility(e.target.value)}
          className="text-xs border border-border rounded px-1 py-0.5 bg-background">
          <option value="item">item only</option>
          <option value="descendants">descendants</option>
        </select>
      </div>
      <textarea value={content} onChange={e => setContent(e.target.value)}
        placeholder="Write in markdown…" autoFocus
        className="w-full p-3 text-xs bg-muted/10 border-0 resize-none outline-none min-h-[100px]" />
      <div className="px-3 py-2 border-t border-border flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={saving || !content.trim()}>
          {saving ? 'Saving…' : 'Add Entry'}
        </Button>
      </div>
    </div>
  )
}

export function JournalTab({ workItemId }) {
  const [entries, setEntries]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [typeFilter, setTypeFilter] = useState(null)
  const [openOnly, setOpenOnly]     = useState(false)
  const [adding, setAdding]         = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.contextEntries(workItemId, typeFilter)
      setEntries(data.rows || [])
    } finally { setLoading(false) }
  }, [workItemId, typeFilter])

  useEffect(() => { load() }, [load])

  const activeTypes = [...new Set(entries.map(e => e.type))]
  const hasDecisions = entries.some(e => e.type === 'decision')
  const displayed = openOnly ? entries.filter(e => e.type === 'decision' && !e.resolved) : entries

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          <button onClick={() => setTypeFilter(null)}
            className={`px-2 py-0.5 rounded-full text-[10px] border ${!typeFilter ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border text-muted-foreground hover:text-foreground'}`}>
            All
          </button>
          {activeTypes.map(t => (
            <button key={t} onClick={() => setTypeFilter(typeFilter === t ? null : t)}
              className={`px-2 py-0.5 rounded-full text-[10px] border ${typeFilter === t ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border text-muted-foreground hover:text-foreground'}`}>
              {t}
            </button>
          ))}
          {hasDecisions && (
            <button onClick={() => setOpenOnly(v => !v)}
              className={`px-2 py-0.5 rounded-full text-[10px] border ${openOnly ? 'bg-[#c8a84b] text-white border-[#c8a84b]' : 'bg-background border-border text-muted-foreground hover:text-foreground'}`}>
              ○ open decisions
            </button>
          )}
        </div>
        {!adding && (
          <Button size="sm" onClick={() => setAdding(true)} className="text-xs">+ Add Entry</Button>
        )}
      </div>

      {adding && (
        <AddEntryForm
          workItemId={workItemId}
          onAdded={entry => { setEntries(prev => [entry, ...prev]); setAdding(false) }}
          onCancel={() => setAdding(false)}
        />
      )}

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : displayed.length === 0 ? (
        <p className="text-xs text-muted-foreground">{openOnly ? 'No open decisions.' : 'No journal entries yet.'}</p>
      ) : (
        displayed.map(entry => (
          <ContextEntryCard
            key={entry.id}
            entry={entry}
            workItemId={workItemId}
            onUpdated={updated => setEntries(prev => prev.map(e => e.id === updated.id ? updated : e))}
            onDeleted={id => setEntries(prev => prev.filter(e => e.id !== id))}
          />
        ))
      )}
    </div>
  )
}
