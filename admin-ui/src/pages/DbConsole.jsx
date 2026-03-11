import { useState, useRef } from 'react'
import { api }    from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Panel, PanelHeader, PanelTitle, PanelMeta } from '@/components/Panel'
import { DataTable } from '@/components/ui/data-table'
import { cn } from '@/lib/utils'

const SNIPPETS = [
  { label: 'work items',
    sql: `SELECT wi.id, wi.title, s.name AS stage, wi.spawn_state, wi.created_at
FROM runtime.work_items wi
JOIN blueprint.stages s ON s.id = wi.current_stage_id
ORDER BY wi.id DESC` },
  { label: 'transition history',
    sql: `SELECT sth.id, wi.title, fs.name AS from_stage, ts.name AS to_stage,
  sth.time_in_stage_seconds, sth.created_at
FROM runtime.stage_transition_history sth
JOIN runtime.work_items wi ON wi.id = sth.work_item_id
JOIN blueprint.stages fs ON fs.id = sth.from_stage_id
JOIN blueprint.stages ts ON ts.id = sth.to_stage_id
ORDER BY sth.id DESC` },
  { label: 'workflows + stages',
    sql: `SELECT w.name AS workflow, s.display_order, s.name AS stage,
  s.stage_class, s.is_entry_stage, s.is_terminal
FROM blueprint.stages s
JOIN blueprint.workflows w ON w.id = s.workflow_id
ORDER BY w.id, s.display_order` },
  { label: 'orgs + members',
    sql: `SELECT o.name AS org, u.display_name, r.name AS role
FROM blueprint.org_memberships om
JOIN blueprint.organizations o ON o.id = om.org_id
JOIN blueprint.users u ON u.id = om.user_id
JOIN blueprint.roles r ON r.id = om.role_id
WHERE om.is_active = true` },
  { label: 'sync queue',     sql: `SELECT * FROM runtime.search_index_queue ORDER BY id DESC` },
  { label: 'all tables',
    sql: `SELECT table_schema, table_name,
  (SELECT COUNT(*) FROM information_schema.columns c
   WHERE c.table_name = t.table_name AND c.table_schema = t.table_schema) AS col_count
FROM information_schema.tables t
WHERE table_schema IN ('blueprint','runtime')
ORDER BY table_schema, table_name` },
]

const PAGE_SIZE = 50

// Strip trailing semicolons and existing LIMIT/OFFSET
function stripPaging(sql) {
  return sql
    .replace(/;+\s*$/, '')
    .replace(/\bLIMIT\s+\d+(\s+OFFSET\s+\d+)?\s*$/i, '')
    .trimEnd()
}

function injectOrder(sql, col, dir) {
  const stripped = sql.replace(/\bORDER\s+BY\b[\s\S]*?(?=\bLIMIT\b|\bOFFSET\b|$)/i, '').trimEnd()
  return `${stripped}\nORDER BY "${col}" ${dir}`
}

export default function DbConsole() {
  const [sql,      setSql]      = useState('')
  const [result,   setResult]   = useState(null)
  const [total,    setTotal]    = useState(0)
  const [running,  setRunning]  = useState(false)
  const [error,    setError]    = useState(null)
  const [duration, setDuration] = useState(null)
  const [sortCol,  setSortCol]  = useState(null)
  const [sortDir,  setSortDir]  = useState('asc')
  const [pageIndex, setPageIndex] = useState(0)

  // Keep base SQL separate from paging/sort injections
  const baseSqlRef = useRef('')

  async function execute(baseSql, col, dir, page) {
    setRunning(true)
    setError(null)

    try {
      let querySql = stripPaging(baseSql)
      if (col) querySql = injectOrder(querySql, col, dir)

      const pagedSql  = `${querySql}\nLIMIT ${PAGE_SIZE} OFFSET ${page * PAGE_SIZE}`

      // Count query — strip ORDER BY for speed
      const countSql = `SELECT COUNT(*) AS __total FROM (${
        querySql.replace(/\bORDER\s+BY\b[\s\S]*/i, '')
      }) __q`

      const [data, countData] = await Promise.all([
        api.query(pagedSql),
        api.query(countSql).catch(() => null),
      ])

      const rowTotal = parseInt(countData?.rows?.[0]?.__total ?? data.count)
      setResult(data)
      setTotal(rowTotal)
      setDuration(data.duration_ms)
    } catch (err) {
      setError(err.message)
      setResult(null)
    } finally {
      setRunning(false)
    }
  }

  function run() {
    baseSqlRef.current = sql
    setSortCol(null)
    setSortDir('asc')
    setPageIndex(0)
    execute(sql, null, 'asc', 0)
  }

  function onSortChange(sorting) {
    if (!sorting.length) return
    const { id: col, desc } = sorting[0]
    const dir = desc ? 'desc' : 'asc'
    setSortCol(col)
    setSortDir(dir)
    setPageIndex(0)
    execute(baseSqlRef.current, col, dir, 0)
  }

  function onPageChange({ pageIndex: p }) {
    setPageIndex(p)
    execute(baseSqlRef.current, sortCol, sortDir, p)
  }

  const columns = result?.columns?.map(col => ({
    accessorKey: col.name,
    header:      col.name,
    cell: ({ getValue }) => {
      const v = getValue()
      if (v === null) return <span className="text-muted-foreground/40">null</span>
      if (typeof v === 'object') return (
        <span className="text-accent text-xs truncate block max-w-[200px]">{JSON.stringify(v)}</span>
      )
      if (typeof v === 'boolean') return (
        <span className={v ? 'text-primary' : 'text-muted-foreground'}>{String(v)}</span>
      )
      return (
        <span className="text-xs truncate block max-w-[240px]" title={String(v)}>{String(v)}</span>
      )
    },
  })) ?? []

  const pageCount = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      {/* Editor */}
      <Panel>
        <PanelHeader>
          <PanelTitle>SQL Console</PanelTitle>
          <span className="text-xs text-muted-foreground">SELECT / EXPLAIN only · Cmd+Enter to run</span>
          <Button
            variant="default" size="sm"
            onClick={run} disabled={running || !sql.trim()}
            className="ml-2"
          >{running ? '⟳ Running' : '▶ Run'}</Button>
        </PanelHeader>

        <textarea
          value={sql}
          onChange={e => setSql(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run() }}
          placeholder="SELECT * FROM runtime.work_items LIMIT 10"
          spellCheck={false}
          rows={6}
          className="w-full bg-background text-accent text-xs p-3 resize-y focus:outline-none border-b border-border"
        />

        <div className="flex flex-wrap gap-1.5 p-2.5">
          {SNIPPETS.map((s, i) => (
            <Button key={i} size="sm" variant="outline"
              onClick={() => { setSql(s.sql); baseSqlRef.current = '' }}
            >{s.label}</Button>
          ))}
        </div>
      </Panel>

      {/* Results */}
      <Panel className="flex-1 min-h-0">
        <PanelHeader>
          <PanelTitle>Results</PanelTitle>
          {duration != null && !error && (
            <PanelMeta>{result?.count ?? 0} of {total} rows · {duration}ms</PanelMeta>
          )}
        </PanelHeader>

        {error ? (
          <div className="p-4 text-xs text-destructive">✗ {error}</div>
        ) : !result ? (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground py-16">
            Run a query to see results
          </div>
        ) : result.rows.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground py-16">
            No rows returned
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={result.rows}
            manualSorting
            manualPagination
            pageCount={pageCount}
            pageIndex={pageIndex}
            pageSize={PAGE_SIZE}
            totalRows={total}
            onSortChange={onSortChange}
            onPageChange={onPageChange}
            isLoading={running}
            className="flex-1 min-h-0"
          />
        )}
      </Panel>
    </div>
  )
}
