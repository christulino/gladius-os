import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const ANTHROPIC_MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-8',
]

export default function OrgAiModels({ orgId }) {
  const [models, setModels]   = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding]   = useState(false)
  const [form, setForm]       = useState({
    name: 'default',
    provider: 'anthropic',
    model: ANTHROPIC_MODELS[0],
    apiKey: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.orgAiModels(orgId).then(d => { setModels(d.rows || []); setLoading(false) })
  }, [orgId])

  async function addModel() {
    if (!form.name || !form.model) return
    setSaving(true)
    try {
      const row = await api.createOrgAiModel(orgId, form)
      setModels(prev => [...prev, row])
      setAdding(false)
      setForm({ name: '', provider: 'anthropic', model: ANTHROPIC_MODELS[0], apiKey: '' })
    } finally { setSaving(false) }
  }

  async function remove(id) {
    if (!confirm('Remove this model config?')) return
    await api.deleteOrgAiModel(orgId, id)
    setModels(prev => prev.filter(m => m.id !== id))
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-foreground">AI Models</p>
          <p className="text-xs text-muted-foreground">
            Named model configs used by stage playbooks. A{' '}
            <code className="bg-muted px-1 rounded text-xs">default</code>{' '}
            model is required to run any playbook.
          </p>
        </div>
        {!adding && <Button size="sm" onClick={() => setAdding(true)}>+ Add Model</Button>}
      </div>

      {adding && (
        <div className="rounded-md border border-primary bg-card p-3 flex flex-col gap-2">
          <div className="flex gap-2">
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Name</label>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="default"
                className="text-xs border border-border rounded px-2 py-1 bg-background"
              />
            </div>
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Provider</label>
              <select
                value={form.provider}
                onChange={e => setForm(f => ({ ...f, provider: e.target.value }))}
                className="text-xs border border-border rounded px-2 py-1 bg-background"
              >
                <option value="anthropic">Anthropic</option>
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Model</label>
            <select
              value={form.model}
              onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
              className="text-xs border border-border rounded px-2 py-1 bg-background"
            >
              {ANTHROPIC_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">API Key</label>
            <input
              type="password"
              value={form.apiKey}
              onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
              placeholder="sk-ant-…"
              className="text-xs border border-border rounded px-2 py-1 bg-background"
            />
          </div>
          <div className="flex justify-end gap-2 mt-1">
            <Button size="sm" variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
            <Button size="sm" onClick={addModel} disabled={saving || !form.name || !form.model}>
              {saving ? 'Saving…' : 'Save Model'}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : models.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No models configured. Add a{' '}
          <code className="bg-muted px-1 rounded text-xs">default</code>{' '}
          model to enable playbooks.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {models.map(m => (
            <div key={m.id} className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
              <Badge variant={m.name === 'default' ? 'default' : 'secondary'}>{m.name}</Badge>
              <span className="text-xs text-muted-foreground">{m.provider}</span>
              <span className="text-xs text-foreground">{m.model}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">key: ••••••••</span>
              <button onClick={() => remove(m.id)} className="text-[10px] text-destructive hover:opacity-80">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
