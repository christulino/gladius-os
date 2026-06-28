import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { DecisionResolution, DecisionStatusBadge } from './DecisionResolution'
import { MarkdownRenderer } from './MarkdownRenderer'

const TYPE_COLORS = {
  nfr:        'bg-[#7a9e6e22] text-[#2d5a27] border-[#2d5a2744]',
  discovery:  'bg-[#c8a84b22] text-[#7a5c00] border-[#c8a84b44]',
  acceptance: 'bg-[#4a7c8e22] text-[#1a4a5e] border-[#4a7c8e44]',
  design:     'bg-[#7a6e9e22] text-[#3a2a6e] border-[#7a6e9e44]',
  decision:   'bg-[#9e7a6e22] text-[#5e2a1a] border-[#9e7a6e44]',
  note:       'bg-[#9e9e6e22] text-[#5e5a1a] border-[#9e9e6e44]',
}

function TypeBadge({ type }) {
  const cls = TYPE_COLORS[type] || 'bg-muted text-muted-foreground border-border'
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border ${cls}`}>
      {type}
    </span>
  )
}


export function ContextEntryCard({ entry, workItemId, onUpdated, onDeleted, inherited = false }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(entry.content)
  const [saving, setSaving]   = useState(false)

  async function save() {
    setSaving(true)
    try {
      const updated = await api.updateContextEntry(workItemId, entry.id, { content: draft })
      onUpdated?.(updated)
      setEditing(false)
    } finally { setSaving(false) }
  }

  async function remove() {
    if (!confirm('Delete this journal entry?')) return
    await api.deleteContextEntry(workItemId, entry.id)
    onDeleted?.(entry.id)
  }

  return (
    <div className={`rounded-md border border-border bg-card overflow-hidden ${inherited ? 'opacity-80' : ''}`}>
      <div className="px-3 py-2 border-b border-border flex items-center gap-2 bg-muted/30">
        <TypeBadge type={entry.type} />
        {entry.type === 'decision' && <DecisionStatusBadge resolved={entry.resolved} />}
        {entry.title && <span className="text-xs font-semibold text-foreground">{entry.title}</span>}
        {entry.is_agent && (
          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">🤖 agent</span>
        )}
        {inherited && (
          <span className="ml-auto text-[10px] text-muted-foreground">↑ inherited</span>
        )}
        {!inherited && !editing && (
          <div className="ml-auto flex gap-2">
            <button onClick={() => { setDraft(entry.content); setEditing(true) }} className="text-[10px] text-muted-foreground hover:text-foreground">✏ Edit</button>
            <button onClick={remove} className="text-[10px] text-destructive hover:opacity-80">✕</button>
          </div>
        )}
        {editing && (
          <div className="ml-auto">
            <button onClick={() => setEditing(false)} className="text-[10px] text-muted-foreground">Cancel</button>
          </div>
        )}
      </div>

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
        <div className="px-3 py-2">
          <MarkdownRenderer content={entry.content} />
        </div>
      )}

      {entry.type === 'decision' && !editing && (
        <DecisionResolution entry={entry} workItemId={workItemId} onUpdated={onUpdated} />
      )}

      <div className="px-3 py-1 border-t border-border flex items-center gap-3 text-[10px] text-muted-foreground">
        <span>{entry.author_name || 'unknown'} · {new Date(entry.created_at).toLocaleDateString()}</span>
        {entry.is_edited && <span className="text-amber-600">edited</span>}
        {entry.visibility === 'descendants' && (
          <span className="ml-auto px-1.5 py-0.5 rounded bg-muted text-muted-foreground">visibility: descendants</span>
        )}
      </div>
    </div>
  )
}
