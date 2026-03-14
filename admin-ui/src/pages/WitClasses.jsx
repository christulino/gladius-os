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

import { useState } from 'react'
import { useApi }     from '@/hooks/useApi'
import { api }        from '@/lib/api'
import { DataTable }  from '@/components/ui/data-table'
import { Badge }      from '@/components/ui/badge'
import { Button }     from '@/components/ui/button'
import { FormDrawer }    from '@/components/FormDrawer'
import { FieldsEditor } from '@/components/FieldsEditor'
import { Panel, PanelHeader, PanelTitle, PanelMeta, LoadingState, ErrorState } from '@/components/Panel'

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

// ─── Class Fields Editor (delegates to shared FieldsEditor) ──────────────────

function ClassFieldsEditor({ classId }) {
  return (
    <FieldsEditor
      title="Class Fields"
      loadFields={() => api.classFields(classId)}
      createField={data => api.createClassField(data)}
      updateField={(id, patch) => api.updateClassField(id, patch)}
      deactivateField={id => api.updateClassField(id, { is_active: false })}
      parentIdField={{ key: 'class_id', value: classId }}
    />
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
        ? <span className="text-xs text-muted-foreground">{getValue()}</span>
        : <span className="text-xs text-muted-foreground/40">none</span>,
    },
    {
      accessorKey: 'owner_org_name', header: 'Owner',
      cell: ({ getValue }) => <span className="text-muted-foreground">{getValue()}</span>,
    },
    {
      accessorKey: 'type_count', header: 'Types Built',
      cell: ({ getValue }) => (
        <span className="text-xs text-muted-foreground text-right block">{getValue()}</span>
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
            <p className="text-xs text-muted-foreground">
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
