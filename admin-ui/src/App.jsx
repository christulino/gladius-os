import { useState, useEffect } from 'react'
import { api } from '@/lib/api'

import Board         from '@/pages/Board'
import Summary       from '@/pages/Summary'
import OrgTypes      from '@/pages/OrgTypes'
import Organizations from '@/pages/Organizations'
import Roles         from '@/pages/Roles'
import Users         from '@/pages/Users'
import WitClasses    from '@/pages/WitClasses'
import WitTypes      from '@/pages/WitTypes'
import WorkItems     from '@/pages/WorkItems'
import Workflows     from '@/pages/Workflows'
import History       from '@/pages/History'
import RawTables     from '@/pages/RawTables'
import LogViewer     from '@/pages/LogViewer'
import DbConsole     from '@/pages/DbConsole'

const NAV = [
  { id: 'board',         label: 'Team Board',      section: 'Board' },

  { id: 'summary',       label: 'Summary',         section: 'Overview' },

  { id: 'orgtypes',      label: 'Org Types',       section: 'Setup' },
  { id: 'organizations', label: 'Organizations',   section: null },
  { id: 'roles',         label: 'Roles',           section: null },
  { id: 'users',         label: 'Users',           section: null },

  { id: 'witclasses',    label: 'Type Classes',    section: 'Catalog' },
  { id: 'wittypes',      label: 'Work Item Types', section: null },
  { id: 'workflows',     label: 'Workflows',       section: null },

  { id: 'workitems',     label: 'Work Items',      section: 'Runtime' },
  { id: 'history',       label: 'Transitions',     section: null },

  { id: 'raw',           label: 'Raw Tables',      section: 'Dev' },
  { id: 'logs',          label: 'Log Viewer',      section: null },
  { id: 'db',            label: 'DB Console',      section: null },
]

const PAGES = {
  board:         Board,
  summary:       Summary,
  orgtypes:      OrgTypes,
  organizations: Organizations,
  roles:         Roles,
  users:         Users,
  witclasses:    WitClasses,
  wittypes:      WitTypes,
  workflows:     Workflows,
  workitems:     WorkItems,
  history:       History,
  raw:           RawTables,
  logs:          LogViewer,
  db:            DbConsole,
}

export default function App() {
  const [tab,     setTab]     = useState('board')
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
              ['orgs',        summary.orgs],
              ['users',       summary.users],
              ['work items',  summary.work_items?.total],
              ['transitions', summary.transitions],
            ].map(([label, val]) => (
              <span key={label} className="font-mono text-[11px] text-muted-foreground">
                {label} <span className="text-primary">{val ?? 0}</span>
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
                    ? 'text-primary bg-primary/10'
                    : 'text-muted-foreground hover:text-foreground hover:bg-black/[0.04]',
                ].join(' ')}
              >
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${tab === item.id ? 'bg-primary' : 'bg-border'}`} />
                {item.label}
              </button>
            </div>
          ))}
        </nav>

        {/* Main */}
        <main className={[
          'flex-1 flex flex-col min-h-0',
          tab === 'board' ? 'overflow-hidden' : 'overflow-auto p-5 gap-4',
        ].join(' ')}>
          <Page setTab={setTab} />
        </main>
      </div>
    </div>
  )
}
