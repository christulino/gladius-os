import { useState, useEffect } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { savedFiltersApi } from '@/lib/api'

export default function SavedFilterFormDrawer({ open, onOpenChange, currentJql, editing, userOrgs, onSaved }) {
  const [name, setName]               = useState('')
  const [shareScope, setShareScope]   = useState('private')
  const [orgId, setOrgId]             = useState(null)
  const [description, setDescription] = useState('')
  const [error, setError]             = useState(null)
  const [saving, setSaving]           = useState(false)

  useEffect(() => {
    if (editing) {
      setName(editing.name || '')
      setShareScope(editing.share_scope || 'private')
      setOrgId(editing.owner_org_id || null)
      setDescription(editing.description || '')
    } else {
      setName(''); setShareScope('private'); setOrgId(null); setDescription('')
    }
    setError(null)
  }, [editing, open])

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        name,
        jql: currentJql,
        share_scope: shareScope,
        owner_org_id: shareScope === 'org' ? orgId : null,
        description: description || null,
      }
      const result = editing
        ? await savedFiltersApi.update(editing.id, payload)
        : await savedFiltersApi.create(payload)
      onSaved(result)
      onOpenChange(false)
    } catch (err) {
      setError(err.body?.message || err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[400px] sm:max-w-[400px]">
        <SheetHeader>
          <SheetTitle className="text-sm">{editing ? 'Edit filter' : 'Save filter'}</SheetTitle>
        </SheetHeader>
        <div className="space-y-3 py-4 px-1">
          <label className="block text-xs">
            <span className="block text-foreground/60 mb-1">Name</span>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full text-sm border border-border rounded px-2 py-1 bg-background"
              placeholder="My P1 bugs"
            />
          </label>
          <div className="text-xs">
            <span className="block text-foreground/60 mb-1">Visibility</span>
            <div className="flex flex-col gap-1.5">
              {['private', 'org', 'global'].map(scope => (
                <label key={scope} className="flex items-center gap-2">
                  <input type="radio" checked={shareScope === scope} onChange={() => setShareScope(scope)} />
                  <span>{scope}</span>
                  {scope === 'org' && shareScope === 'org' && (
                    <select
                      value={orgId || ''}
                      onChange={e => setOrgId(parseInt(e.target.value, 10))}
                      className="text-xs ml-2 border border-border rounded px-1 py-0.5 bg-background"
                    >
                      <option value="">Choose org…</option>
                      {(userOrgs || []).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  )}
                </label>
              ))}
            </div>
          </div>
          <label className="block text-xs">
            <span className="block text-foreground/60 mb-1">Description (optional)</span>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full text-sm border border-border rounded px-2 py-1 bg-background"
              rows={3}
            />
          </label>
          <div className="text-xs text-foreground/60">
            Query: <code className="bg-black/[0.03] px-1 rounded">{currentJql || '(empty)'}</code>
          </div>
          {error && <div className="text-xs text-destructive">{error}</div>}
        </div>
        <SheetFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={!name || saving || !currentJql}>
            {saving ? 'Saving…' : editing ? 'Save' : 'Create'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
