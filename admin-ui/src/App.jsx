import { useState } from 'react'

import Board         from '@/pages/Board'
import Summary       from '@/pages/Summary'
import OrgTypes      from '@/pages/OrgTypes'
import Organizations from '@/pages/Organizations'
import Roles         from '@/pages/Roles'
import Users         from '@/pages/Users'
import WitClasses    from '@/pages/WitClasses'
import WitTypes      from '@/pages/WitTypes'
import WorkItems     from '@/pages/WorkItems'
import WorkflowManager from '@/pages/WorkflowManager'
import LookupLists   from '@/pages/LookupLists'
import History       from '@/pages/History'
import RawTables     from '@/pages/RawTables'
import LogViewer     from '@/pages/LogViewer'
import DbConsole     from '@/pages/DbConsole'
import Reports       from '@/pages/Reports'
import Simulation   from '@/pages/Simulation'

const NAV = [
  { id: 'board',         label: 'Board',            section: null },

  { id: 'organizations', label: 'Organizations',    section: 'Catalog' },
  { id: 'wittypes',      label: 'Work Item Types',  section: null },

  { id: 'witclasses',    label: 'Type Classes',     section: 'Configure' },
  { id: 'workflows',     label: 'Workflows',        section: null },
  { id: 'lookuplists',   label: 'Lists',            section: null },

  { id: 'users',         label: 'Users',            section: 'Admin' },
  { id: 'roles',         label: 'Roles',            section: null },

  { id: 'reports',       label: 'Reports',          section: 'Reports' },

  { id: 'simulation',    label: 'Simulation',       section: 'Dev Tools' },
  { id: 'workitems',     label: 'Work Items',       section: null },
  { id: 'history',       label: 'Transitions',      section: null },
  { id: 'raw',           label: 'Raw Tables',       section: null },
  { id: 'logs',          label: 'Log Viewer',       section: null },
  { id: 'db',            label: 'DB Console',       section: null },
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
  workflows:     WorkflowManager,
  lookuplists:   LookupLists,
  workitems:     WorkItems,
  history:       History,
  raw:           RawTables,
  logs:          LogViewer,
  db:            DbConsole,
  reports:       Reports,
  simulation:    Simulation,
}

export default function App() {
  const [tab, setTab] = useState('board')

  const Page = PAGES[tab] ?? Summary

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Main */}
      <main className={[
        'flex-1 flex flex-col min-h-0',
        tab === 'board' || tab === 'workflows' || tab === 'organizations' ? 'overflow-hidden' : 'overflow-auto p-4 gap-4',
      ].join(' ')}>
        <Page setTab={setTab} />
      </main>

      {/* Sidebar (right) */}
      <nav className="w-44 flex-shrink-0 border-l border-border bg-card overflow-y-auto">
        <div className="px-3 py-3 border-b border-border">
          <span className="text-sm font-semibold text-foreground">Flow OS</span>
        </div>
        <div className="py-3">
          {NAV.map(item => (
            <div key={item.id}>
              {item.section && (
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-3 pt-4 pb-1">
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
        </div>
      </nav>
    </div>
  )
}
