import { useState }  from 'react'
import { useApi }    from '@/hooks/useApi'
import { api }       from '@/lib/api'
import { DataTable } from '@/components/ui/data-table'
import { Badge }     from '@/components/ui/badge'
import { Panel, PanelHeader, PanelTitle, PanelMeta, LoadingState, ErrorState } from '@/components/Panel'

function fmtDuration(sec) {
  if (!sec) return '—'
  if (sec < 60)   return `${sec}s`
  if (sec < 3600) return `${Math.round(sec / 60)}m`
  return `${(sec / 3600).toFixed(1)}h`
}

export default function History() {
  const [offset, setOffset] = useState(0)
  const limit = 50

  const { data, loading, error } = useApi(() => api.transitionHistory(limit, offset), [offset])

  const columns = [
    { accessorKey: 'id',               header: 'ID',
      cell: ({ getValue }) => <span className="text-muted-foreground">{getValue()}</span> },
    { accessorKey: 'work_item_title',   header: 'Work Item',
      cell: ({ getValue }) => (
        <span className="block max-w-[180px] truncate" title={getValue()}>{getValue()}</span>
      )},
    { accessorKey: 'from_stage_name',  header: 'From',
      cell: ({ getValue }) => <Badge variant="muted">{getValue()}</Badge> },
    { accessorKey: 'to_stage_name',    header: 'To',
      cell: ({ getValue }) => <Badge variant="default">{getValue()}</Badge> },
    { accessorKey: 'time_in_stage_seconds', header: 'Time in Stage',
      cell: ({ getValue }) => (
        <span className="text-xs tabular-nums text-right block">{fmtDuration(getValue())}</span>
      )},
    { accessorKey: 'transitioned_by',  header: 'By',
      cell: ({ getValue }) => <span className="text-muted-foreground">{getValue() ?? '—'}</span> },
    { accessorKey: 'was_automated',    header: 'Auto',
      cell: ({ getValue }) => getValue() ? <Badge variant="blue">auto</Badge> : <span className="text-muted-foreground">—</span> },
    { accessorKey: 'transition_reason', header: 'Reason',
      cell: ({ getValue }) => (
        <span className="block max-w-[140px] truncate text-muted-foreground" title={getValue()}>{getValue() ?? '—'}</span>
      )},
    { accessorKey: 'created_at',       header: 'When',
      cell: ({ getValue }) => (
        <span className="text-muted-foreground whitespace-nowrap">{new Date(getValue()).toLocaleString()}</span>
      )},
  ]

  const total     = data?.total ?? 0
  const pageCount = Math.ceil(total / limit)
  const pageIndex = Math.floor(offset / limit)

  return (
    <Panel className="flex-1 min-h-0">
      <PanelHeader>
        <PanelTitle>Transition History</PanelTitle>
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
  )
}
