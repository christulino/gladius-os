import { useState } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
} from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'

export function DataTable({
  columns,
  data,
  onRowClick,
  // For server-side sorting/paging pass these + onSortChange + onPageChange
  pageCount,
  manualSorting    = false,
  manualPagination = false,
  onSortChange,
  onPageChange,
  pageIndex        = 0,
  pageSize         = 50,
  totalRows,
  isLoading        = false,
  className,
}) {
  const [sorting,    setSorting]    = useState([])
  const [pagination, setPagination] = useState({ pageIndex, pageSize })

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting:    manualSorting    ? sorting    : sorting,
      pagination: manualPagination ? { pageIndex, pageSize } : pagination,
    },
    pageCount:          manualPagination ? pageCount : undefined,
    manualSorting,
    manualPagination,
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater
      setSorting(next)
      if (manualSorting && onSortChange) onSortChange(next)
    },
    onPaginationChange: (updater) => {
      const next = typeof updater === 'function' ? updater(manualPagination ? { pageIndex, pageSize } : pagination) : updater
      if (manualPagination && onPageChange) onPageChange(next)
      else setPagination(next)
    },
    getCoreRowModel:       getCoreRowModel(),
    getSortedRowModel:     manualSorting    ? undefined : getSortedRowModel(),
    getPaginationRowModel: manualPagination ? undefined : getPaginationRowModel(),
  })

  const rows       = table.getRowModel().rows
  const totalCount = totalRows ?? data.length
  const curPage    = manualPagination ? pageIndex : pagination.pageIndex
  const curSize    = manualPagination ? pageSize  : pagination.pageSize
  const totalPages = manualPagination ? (pageCount ?? 1) : table.getPageCount()

  return (
    <div className={cn('flex flex-col min-h-0', className)}>
      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-card">
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id}>
                {hg.headers.map(header => {
                  const sorted = header.column.getIsSorted()
                  const canSort = header.column.getCanSort()
                  return (
                    <th
                      key={header.id}
                      className={cn(
                        'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground border-b border-border whitespace-nowrap select-none',
                        canSort && 'cursor-pointer hover:text-foreground'
                      )}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    >
                      <div className="flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort && (
                          <span className="opacity-50 ml-0.5">
                            {sorted === 'asc'  ? <ChevronUp  className="h-3 w-3 opacity-100 text-primary" /> :
                             sorted === 'desc' ? <ChevronDown className="h-3 w-3 opacity-100 text-primary" /> :
                             <ChevronsUpDown className="h-3 w-3" />}
                          </span>
                        )}
                      </div>
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={columns.length} className="px-3 py-10 text-center text-muted-foreground">Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-3 py-10 text-center text-muted-foreground">No results</td></tr>
            ) : rows.map(row => (
              <tr
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                className={cn(
                  'border-b border-border/40 hover:bg-black/[0.03] transition-colors',
                  onRowClick && 'cursor-pointer'
                )}
              >
                {row.getVisibleCells().map(cell => (
                  <td key={cell.id} className="px-3 py-1.5 text-xs text-foreground max-w-[280px]">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center gap-2 px-3 py-2 border-t border-border flex-shrink-0">
          <Button
            variant="outline" size="sm"
            onClick={() => table.previousPage()}
            disabled={curPage === 0}
          >← Prev</Button>
          <Button
            variant="outline" size="sm"
            onClick={() => table.nextPage()}
            disabled={curPage >= totalPages - 1}
          >Next →</Button>
          <span className="ml-auto text-xs text-muted-foreground">
            {curPage * curSize + 1}–{Math.min((curPage + 1) * curSize, totalCount)} of {totalCount}
          </span>
        </div>
      )}
    </div>
  )
}
