/**
 * WitClasses — Global Work Item Type Templates
 *
 * Classes are system-level templates that define the fundamental kinds of work.
 * They are owned by the System org and available to every org in the system.
 *
 * Orgs do not modify classes directly — they create their own Work Item Types
 * based on a class, then customize from there (custom fields, workflows, rules).
 *
 * Think of classes as vocabulary: Bug, Feature, Service Request, etc.
 * Work Item Types are how each org implements that vocabulary for their context.
 */

import { useState, useEffect, useCallback } from 'react'
import { useApi }   from '@/hooks/useApi'
import { api }      from '@/lib/api'
import { DataTable }  from '@/components/ui/data-table'
import { Badge }      from '@/components/ui/badge'
import { Button }     from '@/components/ui/button'
import { FormDrawer } from '@/components/FormDrawer'
import { Panel, PanelHeader, PanelTitle, PanelMeta, LoadingState, ErrorState } from '@/components/Panel'

const FIELD_TYPE_OPTIONS = [
  { label: 'Text',        value: 'text' },
  { label: 'Number',      value: 'number' },
  { label: 'Date',        value: 'date' },
  { label: 'Boolean',     value: 'boolean' },
  { label: 'Select',      value: 'select' },
  { label: 'Multiselect', value: 'multiselect' },
  { label: 'URL',         value: 'url' },
  { label: 'User',        value: 'user' },
  { label: 'Currency',    value: 'currency' },
]

const EDIT_FIELDS = [
  { key: 'name',        label: 'Name',        type: 'text',     required: true },
  { key: 'description', label: 'Description', type: 'textarea' },
  {
    key: 'default_workflow_id', label: 'Default Workflow', type: 'select',
    hint: 'Types based on this class will inherit this workflow.',
    loadOptions: () => api.workflows().then(d =>
      [{ label: '— None —', value: '' }, ...d.rows.map(w => ({ label: w.name, value: w.id }))]
    ),
  },
  { key: 'is_active',   label: 'Active',      type: 'boolean',
    hint: 'Inactive classes are hidden from the type-creation catalog.' },
]

const CREATE_FIELDS = [
  {
    key: 'name', label: 'Class Name', type: 'text', required: true,
    placeholder: 'e.g. Change Request',
    hint: 'Short vocabulary term. Orgs will create types based on this class.',
  },
  {
    key: 'description', label: 'Description', type: 'textarea',
    placeholder: 'What kind of work does this class represent?',
  },
  {
    key: 'owner_org_id', label: 'Owner Org', type: 'select', required: true,
    hint: 'Use System org for shared global classes. Non-system classes are org-private.',
    loadOptions: () => api.organizations().then(d =>
      d.rows.map(o => ({ label: `${o.name} (${o.slug})`, value: o.id }))
    ),
  },
  {
    key: 'default_workflow_id', label: 'Default Workflow', type: 'select',
    hint: 'Types based on this class will inherit this workflow.',
    loadOptions: () => api.workflows().then(d =>
      [{ label: '— None —', value: '' }, ...d.rows.map(w => ({ label: w.name, value: w.id }))]
    ),
  },
]

// ─── Class Fields Editor ──────────────────────────────────────────────────────

function ClassFieldsEditor({ classId }) {
  const [fields, setFields] = useState([])
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newField, setNewField] = useState({ field_key: '', field_label: '', field_type: 'text', is_required: false })

  const loadFields = useCallback(async () => {
    if (!classId) return
    setLoading(true)
    try {
      const res = await api.classFields(classId)
      setFields(res.rows || [])
    } finally { setLoading(false) }
  }, [classId])

  useEffect(() => { loadFields() }, [loadFields])

  async function addField() {
    if (!newField.field_key.trim() || !newField.field_label.trim()) return
    try {
      await api.createClassField({ ...newField, class_id: classId, display_order: fields.length })
      setAdding(false)
      setNewField({ field_key: '', field_label: '', field_type: 'text', is_required: false })
      loadFields()
    } catch (err) { console.error(err) }
  }

  async function toggleRequired(field) {
    try {
      await api.updateClassField(field.id, { is_required: !field.is_required })
      loadFields()
    } catch (err) { console.error(err) }
  }

  async function removeField(field) {
    try {
      await api.deleteClassField(field.id)
      loadFields()
    } catch (err) { console.error(err) }
  }

  if (loading) return <span className="font-mono text-[10px] text-muted-foreground">Loading fields...</span>

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Class Fields</span>
        <button
          onClick={() => setAdding(!adding)}
          className="font-mono text-[10px] text-primary hover:underline"
        >
          {adding ? 'cancel' : '+ add field'}
        </button>
      </div>

      {fields.length === 0 && !adding && (
        <span className="font-mono text-[10px] text-muted-foreground/60">No fields defined yet.</span>
      )}

      {fields.map(f => (
        <div key={f.id} className="flex items-center gap-2 text-xs border border-border/50 rounded px-2.5 py-1.5">
          <span className="font-mono text-[10px] text-muted-foreground w-20 truncate">{f.field_key}</span>
          <span className="flex-1 truncate">{f.field_label}</span>
          <Badge variant="muted" className="text-[8px]">{f.field_type}</Badge>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={f.is_required} onChange={() => toggleRequired(f)} className="accent-primary" />
            <span className="font-mono text-[9px] text-muted-foreground">req</span>
          </label>
          <button onClick={() => removeField(f)} className="text-destructive/60 hover:text-destructive text-xs">×</button>
        </div>
      ))}

      {adding && (
        <div className="flex flex-col gap-2 p-2.5 border border-border rounded bg-background">
          <div className="grid grid-cols-2 gap-2">
            <input
              value={newField.field_key}
              onChange={e => setNewField({ ...newField, field_key: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
              placeholder="field_key"
              className="text-xs font-mono bg-card border border-border rounded px-2 py-1.5 focus:outline-none focus:border-primary"
            />
            <input
              value={newField.field_label}
              onChange={e => setNewField({ ...newField, field_label: e.target.value })}
              placeholder="Field Label"
              className="text-xs bg-card border border-border rounded px-2 py-1.5 focus:outline-none focus:border-primary"
            />
          </div>
          <div className="flex items-center gap-2">
            <select
              value={newField.field_type}
              onChange={e => setNewField({ ...newField, field_type: e.target.value })}
              className="text-xs bg-card border border-border rounded px-2 py-1.5 font-mono flex-1"
            >
              {FIELD_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={newField.is_required} onChange={e => setNewField({ ...newField, is_required: e.target.checked })} className="accent-primary" />
              <span className="font-mono text-[9px] text-muted-foreground">required</span>
            </label>
            <Button size="sm" className="font-mono text-xs" onClick={addField}>Add</Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function WitClasses() {
  const { data, loading, error, reload } = useApi(() => api.witClasses())
  const [creating, setCreating] = useState(false)
  const [editRow,  setEditRow]  = useState(null)

  const columns = [
    {
      accessorKey: 'name', header: 'Class Name',
      cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
    },
    {
      accessorKey: 'description', header: 'Description',
      cell: ({ getValue }) => (
        <span className="text-muted-foreground text-xs truncate max-w-xs block">{getValue() ?? '—'}</span>
      ),
    },
    {
      accessorKey: 'default_workflow_name', header: 'Default Workflow',
      cell: ({ getValue }) => getValue()
        ? <span className="font-mono text-[10px] text-muted-foreground">{getValue()}</span>
        : <span className="font-mono text-[10px] text-muted-foreground/40">none</span>,
    },
    {
      accessorKey: 'owner_org_name', header: 'Owner',
      cell: ({ getValue }) => <span className="text-muted-foreground">{getValue()}</span>,
    },
    {
      accessorKey: 'type_count', header: 'Types Built',
      cell: ({ getValue }) => (
        <span className="font-mono text-[11px] text-muted-foreground text-right block">{getValue()}</span>
      ),
    },
    {
      accessorKey: 'is_system_default', header: '',
      cell: ({ getValue }) => getValue()
        ? <Badge variant="brown">global template</Badge>
        : <Badge variant="muted">org-private</Badge>,
    },
    {
      accessorKey: 'is_active', header: 'Status',
      cell: ({ getValue }) => getValue()
        ? <Badge variant="default">active</Badge>
        : <Badge variant="muted">inactive</Badge>,
    },
  ]

  return (
    <>
      <Panel className="flex-1 min-h-0">
        <PanelHeader>
          <div className="flex flex-col gap-0.5">
            <PanelTitle>Work Item Type Classes</PanelTitle>
            <p className="font-mono text-[10px] text-muted-foreground">
              Global templates. Orgs create their own types based on these classes.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {data && <PanelMeta>{data.count} classes</PanelMeta>}
            <Button size="sm" onClick={() => setCreating(true)}>+ New Class</Button>
          </div>
        </PanelHeader>
        {loading ? <LoadingState /> :
         error   ? <ErrorState message={error} /> :
         <DataTable columns={columns} data={data.rows} className="flex-1 min-h-0"
           onRowClick={setEditRow} />}
      </Panel>

      <FormDrawer
        open={creating}
        onOpenChange={setCreating}
        title="New Work Item Type Class"
        fields={CREATE_FIELDS}
        onSubmit={v => api.createWitClass({
          ...v,
          owner_org_id: parseInt(v.owner_org_id),
          default_workflow_id: v.default_workflow_id ? parseInt(v.default_workflow_id) : null,
        })}
        onSaved={reload}
      />

      <FormDrawer
        open={!!editRow}
        onOpenChange={open => !open && setEditRow(null)}
        title={`Edit Class — ${editRow?.name ?? ''}`}
        fields={EDIT_FIELDS}
        initialValues={editRow}
        onSubmit={v => api.updateWitClass(editRow.id, {
          ...v,
          default_workflow_id: v.default_workflow_id ? parseInt(v.default_workflow_id) : null,
        })}
        onSaved={() => { setEditRow(null); reload() }}
        extraContent={editRow ? <ClassFieldsEditor classId={editRow.id} /> : null}
      />
    </>
  )
}
