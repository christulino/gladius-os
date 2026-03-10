import { useState } from 'react'
import { useApi }   from '@/hooks/useApi'
import { api }      from '@/lib/api'
import { DataTable } from '@/components/ui/data-table'
import { Badge }     from '@/components/ui/badge'
import { Button }    from '@/components/ui/button'
import { EditDrawer } from '@/components/EditDrawer'
import { Panel, PanelHeader, PanelTitle, PanelMeta, LoadingState, ErrorState } from '@/components/Panel'

export default function Organizations() {
  const { data, loading, error, reload } = useApi(() => api.organizations())
  const [editState, setEditState] = useState(null) // { row }

  const columns = [
    { accessorKey: 'id',           header: 'ID',
      cell: ({ getValue }) => <span className="text-muted-foreground">{getValue()}</span> },
    { accessorKey: 'name',         header: 'Name',
      cell: ({ getValue }) => <span className="font-medium">{getValue()}</span> },
    { accessorKey: 'slug',         header: 'Slug',
      cell: ({ getValue }) => <span className="text-muted-foreground">{getValue()}</span> },
    { accessorKey: 'org_type',     header: 'Type',
      cell: ({ getValue }) => <Badge variant="blue">{getValue()}</Badge> },
    { accessorKey: 'parent_name',  header: 'Parent',
      cell: ({ getValue }) => <span className="text-muted-foreground">{getValue() ?? '—'}</span> },
    { accessorKey: 'member_count', header: 'Members',
      cell: ({ getValue }) => <span className="text-right block">{getValue()}</span> },
    { accessorKey: 'work_item_count', header: 'Work Items',
      cell: ({ getValue }) => <span className="text-right block">{getValue()}</span> },
    { accessorKey: 'is_active',    header: 'Status',
      cell: ({ getValue }) => getValue()
        ? <Badge variant="default">active</Badge>
        : <Badge variant="muted">inactive</Badge> },
    { id: 'actions', header: '',
      enableSorting: false,
      cell: ({ row }) => (
        <Button size="sm" variant="ghost" onClick={() => setEditState({ row: row.original })}>
          edit
        </Button>
      )},
  ]

  return (
    <>
      <Panel className="flex-1 min-h-0">
        <PanelHeader>
          <PanelTitle>Organizations</PanelTitle>
          {data && <PanelMeta>{data.count} rows</PanelMeta>}
        </PanelHeader>

        {loading ? <LoadingState /> :
         error   ? <ErrorState message={error} /> :
         <DataTable columns={columns} data={data.rows} className="flex-1 min-h-0" />}
      </Panel>

      <EditDrawer
        open={!!editState}
        onOpenChange={open => !open && setEditState(null)}
        entityType="organization"
        entityId={editState?.row?.id}
        row={editState?.row}
        onSaved={reload}
      />
    </>
  )
}
