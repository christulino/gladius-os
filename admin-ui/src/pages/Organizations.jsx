import { useState } from 'react'
import { useApi }   from '@/hooks/useApi'
import { api }      from '@/lib/api'
import { DataTable }  from '@/components/ui/data-table'
import { Badge }      from '@/components/ui/badge'
import { Button }     from '@/components/ui/button'
import { FormDrawer } from '@/components/FormDrawer'
import { Panel, PanelHeader, PanelTitle, PanelMeta, LoadingState, ErrorState } from '@/components/Panel'

const CREATE_FIELDS = [
  {
    key: 'name', label: 'Name', type: 'text', required: true,
    placeholder: 'e.g. Mobile Engineering',
  },
  {
    key: 'slug', label: 'Slug', isSlug: true, slugFrom: 'name', required: true,
    hint: 'Globally unique URL-safe identifier.',
  },
  {
    key: 'org_type', label: 'Type', type: 'select', required: true,
    loadOptions: () => api.orgTypes().then(d =>
      d.rows.filter(t => t.slug !== 'system' && t.is_active).map(t => ({ label: t.name, value: t.slug }))
    ),
  },
  {
    key: 'parent_id', label: 'Parent Org', type: 'select',
    hint: 'Optional. Leave blank for a top-level org.',
    loadOptions: () => api.organizations().then(d =>
      d.rows.map(o => ({ label: `${o.name} (${o.slug})`, value: o.id }))
    ),
  },
  {
    key: 'description', label: 'Description', type: 'textarea',
    placeholder: 'What does this org do?',
  },
]

const EDIT_FIELDS = [
  { key: 'name',        label: 'Name',        type: 'text',     required: true },
  { key: 'description', label: 'Description', type: 'textarea' },
  {
    key: 'org_type', label: 'Type', type: 'select',
    loadOptions: () => api.orgTypes().then(d =>
      d.rows.filter(t => t.slug !== 'system' && t.is_active).map(t => ({ label: t.name, value: t.slug }))
    ),
  },
  {
    key: 'parent_id', label: 'Parent Org', type: 'select',
    hint: 'Leave blank for a top-level org.',
    loadOptions: () => api.organizations().then(d =>
      d.rows.map(o => ({ label: `${o.name} (${o.slug})`, value: o.id }))
    ),
  },
  { key: 'is_active', label: 'Active', type: 'boolean' },
]

export default function Organizations() {
  const { data, loading, error, reload } = useApi(() => api.organizations())
  const [creating, setCreating] = useState(false)
  const [editRow,  setEditRow]  = useState(null)

  const columns = [
    {
      accessorKey: 'id', header: 'ID',
      cell: ({ getValue }) => <span className="text-muted-foreground">{getValue()}</span>,
    },
    {
      accessorKey: 'name', header: 'Name',
      cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
    },
    {
      accessorKey: 'slug', header: 'Slug',
      cell: ({ getValue }) => <span className="text-muted-foreground">{getValue()}</span>,
    },
    {
      accessorKey: 'org_type', header: 'Type',
      cell: ({ getValue }) => <Badge variant="blue">{getValue()}</Badge>,
    },
    {
      accessorKey: 'parent_name', header: 'Parent',
      cell: ({ getValue }) => <span className="text-muted-foreground">{getValue() ?? '—'}</span>,
    },
    {
      accessorKey: 'member_count', header: 'Members',
      cell: ({ getValue }) => <span className="text-right block">{getValue()}</span>,
    },
    {
      accessorKey: 'work_item_count', header: 'Work Items',
      cell: ({ getValue }) => <span className="text-right block">{getValue()}</span>,
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
          <PanelTitle>Organizations</PanelTitle>
          <div className="flex items-center gap-3">
            {data && <PanelMeta>{data.count} orgs</PanelMeta>}
            <Button size="sm" onClick={() => setCreating(true)}>+ New Org</Button>
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
        title="New Organization"
        fields={CREATE_FIELDS}
        onSubmit={v => api.createOrganization({ ...v, parent_id: v.parent_id ? parseInt(v.parent_id) : null })}
        onSaved={reload}
      />

      <FormDrawer
        open={!!editRow}
        onOpenChange={open => !open && setEditRow(null)}
        title={`Edit — ${editRow?.name ?? ''}`}
        fields={EDIT_FIELDS}
        initialValues={editRow}
        onSubmit={v => api.updateOrganization(editRow.id, { ...v, parent_id: v.parent_id ? parseInt(v.parent_id) : null })}
        onSaved={() => { setEditRow(null); reload() }}
      />
    </>
  )
}
