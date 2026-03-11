import { useState } from 'react'
import { useApi }   from '@/hooks/useApi'
import { api }      from '@/lib/api'
import { DataTable }  from '@/components/ui/data-table'
import { Badge }      from '@/components/ui/badge'
import { Button }     from '@/components/ui/button'
import { FormDrawer } from '@/components/FormDrawer'
import { Panel, PanelHeader, PanelTitle, PanelMeta, LoadingState, ErrorState } from '@/components/Panel'

const EDIT_FIELDS = [
  { key: 'avatar_url',   label: 'Photo',        type: 'image' },
  { key: 'display_name', label: 'Display Name', type: 'text',     required: true },
  { key: 'email',        label: 'Email',        type: 'text',     required: true },
  { key: 'is_system',    label: 'System / Bot', type: 'boolean',  hint: 'System users are bots or automation accounts.' },
  { key: 'is_active',    label: 'Active',       type: 'boolean'  },
]

const CREATE_FIELDS = [
  {
    key: 'avatar_url', label: 'Photo', type: 'image',
  },
  {
    key: 'display_name', label: 'Display Name', type: 'text', required: true,
    placeholder: 'e.g. Chris Tulino',
  },
  {
    key: 'email', label: 'Email', type: 'text', required: true,
    placeholder: 'user@example.com',
  },
  {
    key: 'is_system', label: 'System / Bot User', type: 'boolean',
    hint: 'System users are bots or automation accounts, not humans.',
  },
  {
    key: 'org_id', label: 'First Org (optional)', type: 'select',
    hint: 'Assign to an org now, or skip and add memberships later.',
    loadOptions: () => api.organizations().then(d =>
      d.rows.map(o => ({ label: `${o.name} (${o.slug})`, value: o.id }))
    ),
  },
  {
    key: 'role_id', label: 'Role in that Org', type: 'select',
    dependsOn: 'org_id',
    hint: 'Only available after selecting an org.',
    loadOptions: (values) => {
      if (!values.org_id) return Promise.resolve([])
      return api.roles().then(d =>
        d.rows
          .filter(r => r.org_id === parseInt(values.org_id))
          .map(r => ({ label: r.name, value: r.id }))
      )
    },
  },
]

export default function Users() {
  const { data, loading, error, reload } = useApi(() => api.users())
  const [creating, setCreating] = useState(false)
  const [editRow,  setEditRow]  = useState(null)

  const columns = [
    {
      accessorKey: 'avatar_url', header: '',
      cell: ({ getValue, row }) => {
        const url = getValue()
        const name = row.original.display_name
        return (
          <div className="w-7 h-7 rounded-full border border-border overflow-hidden bg-muted flex items-center justify-center flex-shrink-0">
            {url
              ? <img src={url} alt={name} className="w-full h-full object-cover" />
              : <span className="text-xs text-muted-foreground">{name?.[0]?.toUpperCase() ?? '?'}</span>
            }
          </div>
        )
      },
    },
    {
      accessorKey: 'display_name', header: 'Name',
      cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
    },
    {
      accessorKey: 'email', header: 'Email',
      cell: ({ getValue }) => <span className="text-muted-foreground">{getValue()}</span>,
    },
    {
      accessorKey: 'is_system', header: 'Type',
      cell: ({ getValue }) => getValue()
        ? <Badge variant="blue">system</Badge>
        : <span className="text-muted-foreground text-xs">human</span>,
    },
    {
      accessorKey: 'memberships', header: 'Memberships', enableSorting: false,
      cell: ({ getValue }) => {
        const ms = getValue()
        if (!ms?.length) return <span className="text-muted-foreground">—</span>
        return (
          <div className="flex flex-wrap gap-1">
            {ms.map((m, i) => (
              <Badge key={i} variant="muted">{m.org_slug} · {m.role_name}</Badge>
            ))}
          </div>
        )
      },
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
          <PanelTitle>Users</PanelTitle>
          <div className="flex items-center gap-3">
            {data && <PanelMeta>{data.count} users</PanelMeta>}
            <Button size="sm" onClick={() => setCreating(true)}>+ New User</Button>
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
        title="New User"
        fields={CREATE_FIELDS}
        onSubmit={v => api.createUser({
          ...v,
          org_id:  v.org_id  ? parseInt(v.org_id)  : null,
          role_id: v.role_id ? parseInt(v.role_id) : null,
        })}
        onSaved={reload}
      />

      <FormDrawer
        open={!!editRow}
        onOpenChange={open => !open && setEditRow(null)}
        title={`Edit — ${editRow?.display_name ?? ''}`}
        fields={EDIT_FIELDS}
        initialValues={editRow}
        onSubmit={v => api.updateUser(editRow.id, v)}
        onSaved={() => { setEditRow(null); reload() }}
      />
    </>
  )
}
