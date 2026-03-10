import { useState, useEffect } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet'
import { Button }  from '@/components/ui/button'
import { Switch }  from '@/components/ui/switch'
import { api }     from '@/lib/api'

const EDIT_FIELDS = {
  work_item: [
    { key: 'title',        label: 'Title',              type: 'text' },
    { key: 'description',  label: 'Description',        type: 'textarea' },
    { key: 'field_values', label: 'Field Values (JSON)', type: 'json' },
  ],
  organization: [
    { key: 'name',      label: 'Name',   type: 'text' },
    { key: 'is_active', label: 'Active', type: 'boolean' },
  ],
}

const ENTITY_LABELS = {
  work_item:    'Work Item',
  organization: 'Organization',
}

export function EditDrawer({ open, onOpenChange, entityType, entityId, row, onSaved }) {
  const [values,  setValues]  = useState({})
  const [saving,  setSaving]  = useState(false)
  const [message, setMessage] = useState(null)

  const fields = EDIT_FIELDS[entityType] || []

  // Populate form when row changes
  useEffect(() => {
    if (!row) return
    const initial = {}
    fields.forEach(f => { initial[f.key] = f.type === 'json' ? JSON.stringify(row[f.key] ?? {}, null, 2) : row[f.key] ?? '' })
    setValues(initial)
    setMessage(null)
  }, [row, entityType])

  function set(key, val) {
    setValues(v => ({ ...v, [key]: val }))
    setMessage(null)
  }

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      const updates = {}
      for (const f of fields) {
        if (f.type === 'json') {
          try { updates[f.key] = JSON.parse(values[f.key]) }
          catch { setMessage({ type: 'error', text: `Invalid JSON in "${f.label}"` }); setSaving(false); return }
        } else {
          updates[f.key] = values[f.key]
        }
      }
      const result = await api.edit(entityType, entityId, updates)
      setMessage({ type: 'success', text: `Saved — ${result.fields_changed.join(', ')} updated` })
      setTimeout(() => { onOpenChange(false); onSaved?.() }, 700)
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit {ENTITY_LABELS[entityType] ?? entityType}</SheetTitle>
          <SheetDescription>ID: {entityId}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {fields.map(f => (
            <div key={f.key} className="flex flex-col gap-1.5">
              <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {f.label}
              </label>

              {f.type === 'boolean' ? (
                <div className="flex items-center gap-3">
                  <Switch
                    checked={!!values[f.key]}
                    onCheckedChange={v => set(f.key, v)}
                  />
                  <span className="font-mono text-xs text-muted-foreground">
                    {values[f.key] ? 'Yes' : 'No'}
                  </span>
                </div>
              ) : f.type === 'textarea' || f.type === 'json' ? (
                <textarea
                  value={values[f.key] ?? ''}
                  onChange={e => set(f.key, e.target.value)}
                  rows={f.type === 'json' ? 8 : 4}
                  className="w-full bg-background border border-border rounded text-xs font-mono text-foreground p-2.5 resize-y focus:outline-none focus:border-accent"
                  spellCheck={false}
                />
              ) : (
                <input
                  type="text"
                  value={values[f.key] ?? ''}
                  onChange={e => set(f.key, e.target.value)}
                  className="w-full bg-background border border-border rounded text-xs font-mono text-foreground px-2.5 py-2 focus:outline-none focus:border-accent"
                />
              )}
            </div>
          ))}

          {message && (
            <div className={`font-mono text-[11px] px-3 py-2 rounded ${
              message.type === 'success'
                ? 'bg-primary/10 text-primary'
                : 'bg-destructive/10 text-destructive'
            }`}>
              {message.text}
            </div>
          )}
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="default" onClick={save} disabled={saving} className="flex-1">
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
