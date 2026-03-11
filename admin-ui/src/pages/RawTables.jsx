import { useState }  from 'react'
import { useApi }    from '@/hooks/useApi'
import { api }       from '@/lib/api'
import { DataTable } from '@/components/ui/data-table'
import { Button }    from '@/components/ui/button'
import { Panel, PanelHeader, PanelTitle, PanelMeta, LoadingState, ErrorState, EmptyState } from '@/components/Panel'
import { cn }        from '@/lib/utils'

export default function RawTables() {
  const { data: tablesData } = useApi(() => api.tables())
  const [selected, setSelected] = useState(null)
  const [offset,   setOffset]   = useState(0)
  const limit = 50

  const { data, loading, error } = useApi(
    () => selected ? api.tableData(...selected.split('.'), limit, offset) : Promise.resolve(null),
    [selected, offset]
  )

  const tables    = tablesData?.tables ?? []
  const blueprint = tables.filter(t => t.startsWith('blueprint.'))
  const runtime   = tables.filter(t => t.startsWith('runtime.'))

  function select(t) { setSelected(t); setOffset(0) }

  const columns = data?.columns?.map(col => ({
    accessorKey: col,
    header: col,
    cell: ({ getValue }) => {
      const v = getValue()
      if (v === null) return <span className="text-muted-foreground/50">null</span>
      if (typeof v === 'object') return <span className="text-accent truncate block max-w-[200px]">{JSON.stringify(v)}</span>
      if (typeof v === 'boolean') return (
        <span className={v ? 'text-primary' : 'text-muted-foreground'}>{String(v)}</span>
      )
      return <span className="truncate block max-w-[200px]" title={String(v)}>{String(v)}</span>
    },
  })) ?? []

  const total     = data?.total ?? 0
  const pageCount = Math.ceil(total / limit)
  const pageIndex = Math.floor(offset / limit)

  return (
    <Panel className="flex-1 min-h-0">
      <PanelHeader>
        <PanelTitle>Raw Tables</PanelTitle>
        {data && <PanelMeta>{data.total} rows</PanelMeta>}
      </PanelHeader>

      {/* Table selector */}
      <div className="flex flex-wrap gap-1.5 p-3 border-b border-border">
        {blueprint.length > 0 && (
          <span className="text-xs text-muted-foreground self-center mr-1">blueprint:</span>
        )}
        {blueprint.map(t => (
          <Button key={t} size="sm" variant={selected === t ? 'accent' : 'outline'}
            onClick={() => select(t)}
          >{t.replace('blueprint.', '')}</Button>
        ))}
        {runtime.length > 0 && (
          <span className="text-xs text-muted-foreground self-center ml-2 mr-1">runtime:</span>
        )}
        {runtime.map(t => (
          <Button key={t} size="sm"
            variant={selected === t ? 'accent' : 'outline'}
            className="border-dashed"
            onClick={() => select(t)}
          >{t.replace('runtime.', '')}</Button>
        ))}
      </div>

      {!selected ? <EmptyState message="Select a table to browse" /> :
       loading   ? <LoadingState /> :
       error     ? <ErrorState message={error} /> :
       <DataTable
         columns={columns}
         data={data?.rows ?? []}
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
