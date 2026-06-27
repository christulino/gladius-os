/**
 * FieldsEditor — Shared field definition editor for WIT Classes and WIT Types
 *
 * Used by both ClassFieldsEditor (on WitClasses page) and TypeFieldsEditor (on WitTypes page).
 * Supports 5 field types: text, textarea, number, select, date.
 */

import { useState, useEffect, useCallback } from 'react'
import { api }    from '@/lib/api'
import { Badge }  from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const FIELD_TYPE_OPTIONS = [
  { label: 'Text',      value: 'text' },
  { label: 'Text Area', value: 'textarea' },
  { label: 'Number',    value: 'number' },
  { label: 'Select',    value: 'select' },
  { label: 'Date',      value: 'date' },
]

const LIST_TYPES = ['select']
const CONSTRAINT_TYPES = { text: ['max_length'], textarea: ['max_length'], number: ['min', 'max'] }

function labelToKey(label) {
  return label.trim().toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

// ─── Inline Options Editor ───────────────────────────────────────────────────

function InlineOptionsEditor({ options, onChange }) {
  const items = Array.isArray(options) ? options : []
  const [newLabel, setNewLabel] = useState('')

  function addOption() {
    if (!newLabel.trim()) return
    const nextId = items.length > 0 ? Math.max(...items.map(i => i.id)) + 1 : 1
    onChange([...items, { id: nextId, label: newLabel.trim() }])
    setNewLabel('')
  }

  function removeOption(id) { onChange(items.filter(i => i.id !== id)) }
  function updateLabel(id, label) { onChange(items.map(i => i.id === id ? { ...i, label } : i)) }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">Inline options</span>
      {items.map(item => (
        <div key={item.id} className="flex items-center gap-1">
          <input
            className="flex-1 text-xs px-2 py-0.5 rounded border border-border bg-card focus:border-primary focus:outline-none"
            defaultValue={item.label}
            onBlur={e => updateLabel(item.id, e.target.value)}
            onKeyDown={e => e.key === 'Enter' && e.target.blur()}
          />
          <button onClick={() => removeOption(item.id)} className="text-destructive/60 hover:text-destructive text-xs px-1">×</button>
        </div>
      ))}
      <div className="flex items-center gap-1">
        <input
          className="flex-1 text-xs px-2 py-0.5 rounded border border-border bg-background focus:border-primary focus:outline-none"
          placeholder="New option..."
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addOption()}
        />
        <button onClick={addOption} disabled={!newLabel.trim()} className="text-xs text-primary hover:underline disabled:opacity-30">add</button>
      </div>
    </div>
  )
}

// ─── Constraints Editor ──────────────────────────────────────────────────────

function ConstraintsEditor({ fieldType, constraints, onChange }) {
  const keys = CONSTRAINT_TYPES[fieldType]
  if (!keys) return null
  const vals = constraints || {}

  function set(key, value) {
    const next = { ...vals }
    if (value === '' || value == null) { delete next[key] } else { next[key] = Number(value) }
    onChange(Object.keys(next).length > 0 ? next : null)
  }

  return (
    <div className="flex items-center gap-2">
      {keys.map(k => (
        <div key={k} className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">{k}:</span>
          <input
            type="number"
            className="w-16 text-xs px-1.5 py-0.5 rounded border border-border bg-card focus:border-primary focus:outline-none"
            value={vals[k] ?? ''}
            onChange={e => set(k, e.target.value)}
          />
        </div>
      ))}
    </div>
  )
}

// ─── Field Detail Editor (expanded row) ──────────────────────────────────────

function FieldDetailEditor({ field, lookupLists, onUpdate, onClose }) {
  const isListType = LIST_TYPES.includes(field.field_type)

  async function save(patch) {
    try { await onUpdate(field.id, patch) } catch (err) { console.error(err) }
  }

  return (
    <div className="flex flex-col gap-2 p-2.5 border border-primary/20 rounded bg-background text-xs">
      <div className="flex items-center justify-between">
        <span className="font-medium">{field.field_label}</span>
        <div className="flex items-center gap-2">
          <Badge variant="muted">{field.field_type}</Badge>
          <span className="text-muted-foreground">{field.field_key}</span>
          {field.inherited_from_class_id && <Badge variant="brown">inherited</Badge>}
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">×</button>
        </div>
      </div>

      {/* Label edit */}
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground w-14">Label</span>
        <input
          className="flex-1 text-xs px-2 py-1 rounded border border-border bg-card focus:border-primary focus:outline-none"
          defaultValue={field.field_label}
          onBlur={e => e.target.value !== field.field_label && save({ field_label: e.target.value })}
          onKeyDown={e => e.key === 'Enter' && e.target.blur()}
        />
      </div>

      {/* Group */}
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground w-14">Group</span>
        <input
          className="flex-1 text-xs px-2 py-1 rounded border border-border bg-card focus:border-primary focus:outline-none"
          defaultValue={field.field_group || ''}
          placeholder="e.g. Details, Estimation..."
          onBlur={e => save({ field_group: e.target.value || null })}
          onKeyDown={e => e.key === 'Enter' && e.target.blur()}
        />
      </div>

      {/* Constraints */}
      {CONSTRAINT_TYPES[field.field_type] && (
        <ConstraintsEditor
          fieldType={field.field_type}
          constraints={field.constraints}
          onChange={c => save({ constraints: c })}
        />
      )}

      {/* Lookup list / inline options */}
      {isListType && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-14">List</span>
            <select
              className="flex-1 text-xs px-2 py-1 rounded border border-border bg-card focus:border-primary focus:outline-none"
              value={field.lookup_list_id || ''}
              onChange={e => save({ lookup_list_id: e.target.value ? parseInt(e.target.value) : null })}
            >
              <option value="">— Inline options —</option>
              {lookupLists.map(ll => (
                <option key={ll.id} value={ll.id}>{ll.name} ({ll.org_slug})</option>
              ))}
            </select>
          </div>
          {!field.lookup_list_id && (
            <InlineOptionsEditor
              options={field.field_options}
              onChange={opts => save({ field_options: opts })}
            />
          )}
        </div>
      )}

      {/* Required toggle */}
      <label className="flex items-center gap-1.5 cursor-pointer">
        <input
          type="checkbox"
          checked={!!field.is_required}
          onChange={e => save({ is_required: e.target.checked })}
          className="accent-primary"
        />
        <span className="text-muted-foreground">Required field</span>
      </label>
    </div>
  )
}

// ─── Main FieldsEditor Component ─────────────────────────────────────────────

/**
 * @param {Object} props
 * @param {string} props.title           - Section heading (e.g. "Class Fields", "Type Fields")
 * @param {Function} props.loadFields    - async () => { rows: [...] }
 * @param {Function} props.createField   - async (data) => created field
 * @param {Function} props.updateField   - async (id, patch) => updated field
 * @param {Function} props.deactivateField - async (id) => void
 * @param {Object} props.parentIdField   - { key: 'class_id'|'work_item_type_id', value: number }
 */
export function FieldsEditor({ title, loadFields, createField, updateField, deactivateField, parentIdField }) {
  const [fields, setFields] = useState([])
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [lookupLists, setLookupLists] = useState([])
  const [newField, setNewField] = useState({ field_label: '', field_type: 'text' })

  const load = useCallback(async () => {
    if (!parentIdField?.value) return
    setLoading(true)
    try {
      const [res, llRes] = await Promise.all([loadFields(), api.lookupLists()])
      setFields(res.rows || [])
      setLookupLists(llRes.rows || [])
    } finally { setLoading(false) }
  }, [parentIdField?.value])

  useEffect(() => { load() }, [load])

  async function addField() {
    const label = newField.field_label.trim()
    if (!label) return
    const key = labelToKey(label)
    if (!key) return
    try {
      await createField({
        [parentIdField.key]: parentIdField.value,
        field_key: key,
        field_label: label,
        field_type: newField.field_type,
        display_order: fields.length,
      })
      setAdding(false)
      setNewField({ field_label: '', field_type: 'text' })
      load()
    } catch (err) { console.error(err) }
  }

  async function handleUpdate(id, patch) {
    await updateField(id, patch)
    load()
  }

  async function handleDeactivate(field) {
    await deactivateField(field.id)
    load()
  }

  if (loading) return <span className="text-xs text-muted-foreground">Loading fields...</span>

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</span>
        <button onClick={() => setAdding(!adding)} className="text-xs text-primary hover:underline">
          {adding ? 'cancel' : '+ add field'}
        </button>
      </div>

      {fields.length === 0 && !adding && (
        <span className="text-xs text-muted-foreground/60">No fields defined yet.</span>
      )}

      {fields.map(f => (
        expandedId === f.id ? (
          <FieldDetailEditor
            key={f.id}
            field={f}
            lookupLists={lookupLists}
            onUpdate={handleUpdate}
            onClose={() => setExpandedId(null)}
          />
        ) : (
          <div
            key={f.id}
            className="flex items-center gap-2 text-xs border border-border/50 rounded px-2.5 py-1.5 cursor-pointer hover:border-border transition-colors"
            onClick={() => setExpandedId(f.id)}
          >
            <span className="text-muted-foreground w-20 truncate" title={f.field_key}>{f.field_key}</span>
            <span className="flex-1 truncate">{f.field_label}</span>
            <Badge variant="muted">{f.field_type}</Badge>
            {f.is_required && <Badge variant="amber">req</Badge>}
            {f.lookup_list_id && <Badge variant="blue">list</Badge>}
            {f.inherited_from_class_id && <Badge variant="brown">inherited</Badge>}
            <button
              onClick={e => { e.stopPropagation(); handleDeactivate(f) }}
              className="text-destructive/60 hover:text-destructive text-xs"
              title="Deactivate field"
            >×</button>
          </div>
        )
      ))}

      {adding && (
        <div className="flex flex-col gap-2 p-2.5 border border-border rounded bg-background">
          <input
            value={newField.field_label}
            onChange={e => setNewField({ ...newField, field_label: e.target.value })}
            placeholder="Field Label (e.g. Root Cause Analysis)"
            className="text-xs bg-card border border-border rounded px-2 py-1.5 focus:outline-none focus:border-primary"
            autoFocus
          />
          {newField.field_label.trim() && (
            <span className="text-xs text-muted-foreground">
              Key: <span className="text-foreground">{labelToKey(newField.field_label)}</span>
            </span>
          )}
          <div className="flex items-center gap-2">
            <select
              value={newField.field_type}
              onChange={e => setNewField({ ...newField, field_type: e.target.value })}
              className="text-xs bg-card border border-border rounded px-2 py-1.5 flex-1"
            >
              {FIELD_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <Button size="sm" onClick={addField} disabled={!newField.field_label.trim()}>Add</Button>
          </div>
        </div>
      )}
    </div>
  )
}
