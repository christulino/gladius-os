import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { AddOrgContextForm } from '@/components/AddOrgContextForm'

const ORG_CONTEXT_TYPES = ['architecture', 'standards', 'security', 'domain', 'working-agreements']

const TYPE_COLORS = {
  architecture:         'bg-[#c8a84b22] text-[#7a5c00] border-[#c8a84b44]',
  standards:            'bg-[#4a7c8e22] text-[#1a4a5e] border-[#4a7c8e44]',
  security:             'bg-[#c0392b22] text-[#7a1a1a] border-[#c0392b44]',
  domain:               'bg-[#7a9e6e22] text-[#2d5a27] border-[#2d5a2744]',
  'working-agreements': 'bg-[#9e9e6e22] text-[#5e5a1a] border-[#9e9e6e44]',
}

function TypeBadge({ type }) {
  const cls = TYPE_COLORS[type] || 'bg-muted text-muted-foreground border-border'
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border ${cls}`}>
      {type}
    </span>
  )
}

function OrgContextCard({ entry, orgId, onUpdated, onDeleted }) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing]   = useState(false)
  const [draft, setDraft]       = useState(entry.content)
  const [saving, setSaving]     = useState(false)

  async function save() {
    setSaving(true)
    try {
      const updated = await api.updateOrgContext(orgId, entry.id, { content: draft })
      onUpdated(updated)
      setEditing(false)
    } finally { setSaving(false) }
  }

  async function remove() {
    if (!confirm('Delete this context entry?')) return
    await api.deleteOrgContext(orgId, entry.id)
    onDeleted(entry.id)
  }

  return (
    <div className="rounded-md border border-border bg-card overflow-hidden">
      <div
        className="px-3 py-2 flex items-center gap-2 cursor-pointer hover:bg-muted/30"
        onClick={() => !editing && setExpanded(e => !e)}
      >
        <span className="text-[10px] text-muted-foreground">{expanded ? '▼' : '▶'}</span>
        <TypeBadge type={entry.type} />
        <span className="text-xs font-semibold text-foreground">{entry.title}</span>
        <div className="ml-auto flex gap-3" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => { setExpanded(true); setDraft(entry.content); setEditing(true) }}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            ✏ Edit
          </button>
          <button onClick={remove} className="text-[10px] text-destructive hover:opacity-80">✕</button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border">
          {editing ? (
            <div className="flex flex-col">
              <textarea
                className="w-full p-3 text-xs bg-muted/10 border-0 resize-none outline-none min-h-[120px]"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                autoFocus
              />
              <div className="px-3 py-2 border-t border-border flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
                <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
              </div>
            </div>
          ) : (
            <pre className="px-4 py-3 text-xs whitespace-pre-wrap leading-relaxed text-foreground">{entry.content}</pre>
          )}
          <div className="px-3 py-1 border-t border-border text-[10px] text-muted-foreground flex gap-3">
            <span>{entry.author_name || 'unknown'} · {new Date(entry.created_at).toLocaleDateString()}</span>
            {entry.is_edited && <span className="text-amber-600">edited</span>}
          </div>
        </div>
      )}
    </div>
  )
}

export default function OrgContextLibrary({ orgId }) {
  const [entries, setEntries]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [typeFilter, setFilter] = useState(null)
  const [adding, setAdding]     = useState(false)

  useEffect(() => {
    setLoading(true)
    api.orgContext(orgId, typeFilter).then(d => {
      setEntries(d.rows || [])
      setLoading(false)
    })
  }, [orgId, typeFilter])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-foreground">Context Library</p>
          <p className="text-xs text-muted-foreground">Background knowledge injected into every agent working in this org</p>
        </div>
        {!adding && <Button size="sm" onClick={() => setAdding(true)}>+ Add Entry</Button>}
      </div>

      <div className="flex gap-1 flex-wrap">
        {['all', ...ORG_CONTEXT_TYPES].map(t => (
          <button
            key={t}
            onClick={() => setFilter(t === 'all' ? null : t)}
            className={`px-2 py-0.5 rounded-full text-[10px] border ${
              (!typeFilter && t === 'all') || typeFilter === t
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {adding && (
        <AddOrgContextForm
          orgId={orgId}
          onAdded={e => { setEntries(prev => [e, ...prev]); setAdding(false) }}
          onCancel={() => setAdding(false)}
        />
      )}

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">No context entries yet.</p>
      ) : (
        entries.map(entry => (
          <OrgContextCard
            key={entry.id}
            entry={entry}
            orgId={orgId}
            onUpdated={updated => setEntries(prev => prev.map(e => e.id === updated.id ? updated : e))}
            onDeleted={id => setEntries(prev => prev.filter(e => e.id !== id))}
          />
        ))
      )}
    </div>
  )
}
