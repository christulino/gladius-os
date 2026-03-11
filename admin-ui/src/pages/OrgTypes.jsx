import { useState } from 'react'
import { useApi }   from '@/hooks/useApi'
import { api }      from '@/lib/api'
import { DataTable } from '@/components/ui/data-table'
import { Badge }     from '@/components/ui/badge'
import { Button }    from '@/components/ui/button'
import { FormDrawer } from '@/components/FormDrawer'
import { Panel, PanelHeader, PanelTitle, PanelMeta, LoadingState, ErrorState } from '@/components/Panel'

const CREATE_FIELDS = [
  { key: 'name',        label: 'Name',        type: 'text',     required: true, placeholder: 'e.g. Platform Team' },
  { key: 'slug',        label: 'Slug',         isSlug: true,    slugFrom: 'name', required: true, hint: 'URL-safe identifier. Auto-generated — override if needed.' },
  { key: 'description', label: 'Description',  type: 'textarea', placeholder: 'What kind of org does this describe?' },
  { key: 'sort_order',  label: 'Sort Order',   type: 'text',    defaultValue: '0', hint: 'Controls display order in selects. Lower = first.' },
]

const EDIT_FIELDS = [
  { key: 'name',        label: 'Name',        type: 'text',     required: true },
  { key: 'slug',        label: 'Slug',         isSlug: true,    required: true, hint: 'Changing the slug may break existing references.' },
  { key: 'description', label: 'Description',  type: 'textarea' },
  { key: 'sort_order',  label: 'Sort Order',   type: 'text' },
  { key: 'is_active',   label: 'Active',       type: 'boolean' },
]

export default function OrgTypes() {
  const { data, loading, error, reload } = useApi(() => api.orgTypes())
  const [creating, setCreating] = useState(false)
  const [editRow,  setEditRow]  = useState(null)

  const columns = [
    { accessorKey: 'name',        header: 'Name',        cell: ({ getValue }) => <span className="font-medium">{getValue()}</span> },
    { accessorKey: 'slug',        header: 'Slug',        cell: ({ getValue }) => <span className="text-muted-foreground">{getValue()}</span> },
    { accessorKey: 'description', header: 'Description', cell: ({ getValue }) => <span className="text-muted-foreground">{getValue() ?? '—'}</span> },
    { accessorKey: 'sort_order',  header: 'Order',       cell: ({ getValue }) => <span className="text-right block text-muted-foreground">{getValue()}</span> },
    { accessorKey: 'is_active',   header: 'Status',      cell: ({ getValue }) => getValue() ? <Badge variant="default">active</Badge> : <Badge variant="muted">inactive</Badge> },
  ]

  return (
    <>
      <Panel className="flex-1 min-h-0">
        <PanelHeader>
          <PanelTitle>Org Types</PanelTitle>
          <div className="flex items-center gap-3">
            {data && <PanelMeta>{data.count} types</PanelMeta>}
            <Button size="sm" onClick={() => setCreating(true)}>+ New Type</Button>
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
        title="New Org Type"
        fields={CREATE_FIELDS}
        onSubmit={v => api.createOrgType({ ...v, sort_order: parseInt(v.sort_order) || 0 })}
        onSaved={reload}
      />

      <FormDrawer
        open={!!editRow}
        onOpenChange={open => !open && setEditRow(null)}
        title={`Edit — ${editRow?.name ?? ''}`}
        fields={EDIT_FIELDS}
        initialValues={editRow}
        onSubmit={v => api.updateOrgType(editRow.id, { ...v, sort_order: parseInt(v.sort_order) || 0 })}
        onSaved={() => { setEditRow(null); reload() }}
      />
    </>
  )
}
