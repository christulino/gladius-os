import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import Summary      from '@/pages/Summary'
import Organizations from '@/pages/Organizations'
import WorkItems    from '@/pages/WorkItems'
import Workflows    from '@/pages/Workflows'
import Users        from '@/pages/Users'
import History      from '@/pages/History'
import RawTables    from '@/pages/RawTables'
import LogViewer    from '@/pages/LogViewer'
import DbConsole    from '@/pages/DbConsole'

const NAV = [
  { id: 'summary',       label: 'Summary',      section: 'Browser' },
  { id: 'organizations', label: 'Organizations', section: null },
  { id: 'workitems',     label: 'Work Items',    section: null },
  { id: 'workflows',     label: 'Workflows',     section: null },
  { id: 'users',         label: 'Users',         section: null },
  { id: 'history',       label: 'Transitions',   section: null },
  { id: 'raw',           label: 'Raw Tables',    section: 'Raw' },
  { id: 'logs',          label: 'Log Viewer',    section: 'DevTools' },
  { id: 'db',            label: 'DB Console',    section: null },
]

const PAGES = {
  summary:       Summary,
  organizations: Organizations,
  workitems:     WorkItems,
  workflows:     Workflows,
  users:         Users,
  history:       History,
  raw:           RawTables,
  logs:          LogViewer,
  db:            DbConsole,
}

export default function App() {
  const [tab,     setTab]     = useState('summary')
  const [summary, setSummary] = useState(null)

  useEffect(() => {
    api.summary().then(setSummary).catch(() => {})
  }, [])

  const Page = PAGES[tab] ?? Summary

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      {/* Header */}
      <header className="flex items-center gap-3 px-5 h-12 border-b border-border bg-card flex-shrink-0">
        <span className="font-mono text-xs text-primary tracking-widest uppercase">Flow OS</span>
        <span className="text-border">/</span>
        <span className="text-xs text-muted-foreground">Admin</span>
        {summary && (
          <div className="ml-auto flex gap-5">
            {[
              ['orgs',       summary.orgs],
              ['work items', summary.work_items?.total],
              ['transitions',summary.transitions],
            ].map(([label, val]) => (
              <span key={label} className="font-mono text-[11px] text-muted-foreground">
                {label} <span className="text-primary">{val}</span>
              </span>
            ))}
            {summary.sync_queue_depth > 0 && (
              <span className="font-mono text-[11px] text-orange-400">
                sync queue <span>{summary.sync_queue_depth}</span>
              </span>
            )}
          </div>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <nav className="w-44 flex-shrink-0 border-r border-border bg-card overflow-y-auto py-3">
          {NAV.map(item => (
            <div key={item.id}>
              {item.section && (
                <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest px-4 pt-4 pb-1">
                  {item.section}
                </div>
              )}
              <button
                onClick={() => setTab(item.id)}
                className={[
                  'flex items-center gap-2 w-full px-4 py-1.5 text-xs text-left transition-colors',
                  tab === item.id
                    ? 'text-primary bg-primary/8'
                    : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.03]'
                ].join(' ')}
              >
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${tab === item.id ? 'bg-primary' : 'bg-border'}`} />
                {item.label}
              </button>
            </div>
          ))}
        </nav>

        {/* Main */}
        <main className="flex-1 overflow-auto p-5 flex flex-col gap-4 min-h-0">
          <Page />
        </main>
      </div>
    </div>
  )
}
