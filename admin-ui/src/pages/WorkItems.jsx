import { useState } from 'react'
import { useApi }    from '@/hooks/useApi'
import { api }       from '@/lib/api'
import { DataTable } from '@/components/ui/data-table'
import { Badge }     from '@/components/ui/badge'
import { Button }    from '@/components/ui/button'
import { EditDrawer } from '@/components/EditDrawer'
import { Panel, PanelHeader, PanelTitle, PanelMeta, LoadingState, ErrorState } from '@/components/Panel'

const STATE_VARIANT = { active: 'default', pending: 'orange', done: 'blue', cancelled: 'muted' }
const CLASS_VARIANT = {
  intake: 'blue', 'in-progress': 'default', review: 'orange',
  done: 'blue', cancelled: 'red', blocked: 'red', triage: 'orange', queued: 'muted',
}

export default function WorkItems() {
  const [offset, setOffset]     = useState(0)
  const [editState, setEditState] = useState(null)
  const limit = 50

  const { data, loading, error, reload } = useApi(() => api.workItems(limit, offset), [offset])

  const columns = [
    { accessorKey: 'id',    header: 'ID',
      cell: ({ getValue }) => <span className="text-muted-foreground">{getValue()}</span> },
    { accessorKey: 'title', header: 'Title',
      cell: ({ getValue }) => (
        <span className="block max-w-[220px] truncate font-medium" title={getValue()}>{getValue()}</span>
      )},
    { accessorKey: 'work_item_type_name', header: 'Type',
      cell: ({ getValue }) => <Badge variant="muted">{getValue()}</Badge> },
    { accessorKey: 'current_stage_name', header: 'Stage',
      cell: ({ row }) => (
        <Badge variant={CLASS_VARIANT[row.original.current_stage_class] ?? 'muted'}>
          {row.original.current_stage_name}
        </Badge>
      )},
    { accessorKey: 'spawn_state', header: 'State',
      cell: ({ getValue }) => <Badge variant={STATE_VARIANT[getValue()] ?? 'muted'}>{getValue()}</Badge> },
    { accessorKey: 'org_slug', header: 'Org',
      cell: ({ getValue }) => <span className="text-muted-foreground">{getValue()}</span> },
    { accessorKey: 'created_at', header: 'Created',
      cell: ({ getValue }) => (
        <span className="text-muted-foreground whitespace-nowrap">
          {new Date(getValue()).toLocaleDateString()}
        </span>
      )},
    { id: 'actions', header: '', enableSorting: false,
      cell: ({ row }) => (
        <Button size="sm" variant="ghost" onClick={() => setEditState({ row: row.original })}>
          edit
        </Button>
      )},
  ]

  const total     = data?.total ?? 0
  const pageCount = Math.ceil(total / limit)
  const pageIndex = Math.floor(offset / limit)

  return (
    <>
      <Panel className="flex-1 min-h-0">
        <PanelHeader>
          <PanelTitle>Work Items</PanelTitle>
          {data && <PanelMeta>{data.total} total</PanelMeta>}
        </PanelHeader>

        {loading ? <LoadingState /> :
         error   ? <ErrorState message={error} /> :
         <DataTable
           columns={columns}
           data={data.rows}
           manualPagination
           pageCount={pageCount}
           pageIndex={pageIndex}
           pageSize={limit}
           totalRows={total}
           onPageChange={({ pageIndex: p }) => setOffset(p * limit)}
           className="flex-1 min-h-0"
         />}
      </Panel>

      <EditDrawer
        open={!!editState}
        onOpenChange={open => !open && setEditState(null)}
        entityType="work_item"
        entityId={editState?.row?.id}
        row={editState?.row}
        onSaved={reload}
      />
    </>
  )
}
