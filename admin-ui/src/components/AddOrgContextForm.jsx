import { useState } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'

const ORG_CONTEXT_TYPES = ['architecture', 'standards', 'security', 'domain', 'working-agreements']

export function AddOrgContextForm({ orgId, onAdded, onCancel }) {
  const [type, setType]       = useState('architecture')
  const [title, setTitle]     = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving]   = useState(false)

  async function submit() {
    if (!title.trim() || !content.trim()) return
    setSaving(true)
    try {
      const row = await api.createOrgContext(orgId, { type, title, content })
      onAdded(row)
    } finally { setSaving(false) }
  }

  return (
    <div className="rounded-md border border-primary bg-card overflow-hidden">
      <div className="px-3 py-2 border-b border-border flex items-center gap-2 bg-muted/30">
        <select
          value={type}
          onChange={e => setType(e.target.value)}
          className="text-xs border border-border rounded px-1 py-0.5 bg-background"
        >
          {ORG_CONTEXT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Title"
          className="flex-1 text-xs border border-border rounded px-2 py-0.5 bg-background"
        />
      </div>
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="Write in markdown…"
        autoFocus
        className="w-full p-3 text-xs bg-muted/10 border-0 resize-none outline-none min-h-[120px]"
      />
      <div className="px-3 py-2 border-t border-border flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button
          size="sm"
          onClick={submit}
          disabled={saving || !title.trim() || !content.trim()}
        >
          {saving ? 'Saving…' : 'Add Entry'}
        </Button>
      </div>
    </div>
  )
}
