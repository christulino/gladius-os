import { useApi }   from '@/hooks/useApi'
import { api }      from '@/lib/api'
import { DataTable } from '@/components/ui/data-table'
import { Badge }    from '@/components/ui/badge'
import { Panel, PanelHeader, PanelTitle, PanelMeta, LoadingState, ErrorState } from '@/components/Panel'

export default function Users() {
  const { data, loading, error } = useApi(() => api.users())

  const columns = [
    { accessorKey: 'id',           header: 'ID',
      cell: ({ getValue }) => <span className="text-muted-foreground">{getValue()}</span> },
    { accessorKey: 'display_name', header: 'Name',
      cell: ({ getValue }) => <span className="font-medium">{getValue()}</span> },
    { accessorKey: 'email',        header: 'Email',
      cell: ({ getValue }) => <span className="text-muted-foreground">{getValue()}</span> },
    { accessorKey: 'memberships',  header: 'Memberships', enableSorting: false,
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
      }},
    { accessorKey: 'is_active',    header: 'Status',
      cell: ({ getValue }) => getValue()
        ? <Badge variant="default">active</Badge>
        : <Badge variant="muted">inactive</Badge> },
  ]

  return (
    <Panel className="flex-1 min-h-0">
      <PanelHeader>
        <PanelTitle>Users</PanelTitle>
        {data && <PanelMeta>{data.count} rows</PanelMeta>}
      </PanelHeader>
      {loading ? <LoadingState /> :
       error   ? <ErrorState message={error} /> :
       <DataTable columns={columns} data={data.rows} className="flex-1 min-h-0" />}
    </Panel>
  )
}
