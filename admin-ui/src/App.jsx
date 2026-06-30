import { useState, useEffect } from 'react'
import { auth } from '@/lib/api'
import {
  LayoutDashboard,
  Building2,
  Shapes,
  FolderTree,
  GitBranch,
  List,
  Users as UsersIcon,
  Shield,
  BarChart3,
  Play,
  FileText,
  ArrowRightLeft,
  Table2,
  ScrollText,
  Database,
  Activity,
  BellRing,
  Search as SearchIcon,
  Terminal as TerminalIcon,
  BookOpen,
  Cpu,
} from 'lucide-react'
import NotificationsBell from '@/components/NotificationsBell'
import NotificationsDrawer from '@/components/NotificationsDrawer'

import Login         from '@/pages/Login'
import Setup         from '@/pages/Setup'
import IntakeForm    from '@/pages/IntakeForm'
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
import EventSubscribers from '@/pages/EventSubscribers'
import SettingsNotifications from '@/pages/SettingsNotifications'
import SearchPage    from '@/pages/SearchPage'
import MCPTools      from '@/pages/MCPTools'
import ContextLibraryPage from '@/pages/ContextLibraryPage'
import AiModelsPage  from '@/pages/AiModelsPage'

const NAV = [
  { id: 'board',         label: 'Board',            section: null,       icon: LayoutDashboard },
  { id: 'search',        label: 'Search',           section: null,       icon: SearchIcon },

  { id: 'organizations', label: 'Organizations',    section: 'Catalog',   icon: Building2 },
  { id: 'wittypes',      label: 'Work Item Types',  section: null,       icon: Shapes },

  { id: 'witclasses',    label: 'Type Classes',     section: 'Configure', icon: FolderTree },
  { id: 'workflows',     label: 'Workflows',        section: null,       icon: GitBranch },
  { id: 'lookuplists',   label: 'Lists',            section: null,       icon: List },

  { id: 'context-library', label: 'Context Library', section: 'Context / AI', icon: BookOpen },
  { id: 'ai-models',       label: 'AI Models',        section: null,           icon: Cpu },
  { id: 'mcp-tools',       label: 'MCP Tools',        section: null,           icon: TerminalIcon },

  { id: 'users',         label: 'Users',            section: 'Admin',     icon: UsersIcon },
  { id: 'roles',         label: 'Roles',            section: null,       icon: Shield },

  { id: 'reports',       label: 'Reports',          section: 'Reports',   icon: BarChart3 },

  { id: 'settingsnotifications', label: 'Notifications', section: 'Settings', icon: BellRing },

  { id: 'simulation',    label: 'Simulation',       section: 'Dev Tools', icon: Play },
  { id: 'workitems',     label: 'Work Items',       section: null,       icon: FileText },
  { id: 'history',       label: 'Transitions',      section: null,       icon: ArrowRightLeft },
  { id: 'raw',           label: 'Raw Tables',       section: null,       icon: Table2 },
  { id: 'logs',          label: 'Log Viewer',       section: null,       icon: ScrollText },
  { id: 'db',            label: 'DB Console',       section: null,       icon: Database },
  { id: 'events',        label: 'Events',           section: null,       icon: Activity },
]

const PAGES = {
  board:         Board,
  search:        SearchPage,
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
  events:        EventSubscribers,
  settingsnotifications: SettingsNotifications,
  'mcp-tools':          MCPTools,
  'context-library':    ContextLibraryPage,
  'ai-models':          AiModelsPage,
}

export default function App() {
  const [tab, setTab]           = useState('board')
  const [authState, setAuthState] = useState('loading')  // 'loading' | 'setup' | 'login' | 'authenticated'
  const [user, setUser]         = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // '/' keybinding to jump to Search (when not editing).
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target
      const isEditable = t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable
      if (isEditable) return
      if (e.key === '/') {
        e.preventDefault()
        setTab('search')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Check auth status on mount
  useEffect(() => {
    auth.status()
      .then(({ needsSetup, authenticated, user }) => {
        if (needsSetup)       setAuthState('setup')
        else if (authenticated && user) { setUser(user); setAuthState('authenticated') }
        else                  setAuthState('login')
      })
      .catch(() => setAuthState('login'))
  }, [])

  function handleLogin(u) {
    setUser(u)
    setAuthState('authenticated')
  }

  function handleSetup(u) {
    setUser(u)
    setAuthState('authenticated')
  }

  async function handleLogout() {
    try { await auth.logout() } catch {}
    setUser(null)
    setAuthState('login')
  }

  // ─── Public intake form (no auth, no sidebar) ───
  const formsMatch = window.location.pathname.match(/^\/intake\/([a-z0-9-]+)\/?$/)
  if (formsMatch) {
    return <IntakeForm slug={formsMatch[1]} />
  }

  // ─── Loading ───
  if (authState === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-xs text-muted-foreground">Loading...</p>
      </div>
    )
  }

  // ─── Setup wizard ───
  if (authState === 'setup') {
    return <Setup onSetup={handleSetup} />
  }

  // ─── Login ───
  if (authState === 'login') {
    return <Login onLogin={handleLogin} />
  }

  // ─── Authenticated app ───
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
      <nav className="w-44 flex-shrink-0 border-l border-border bg-card flex flex-col">
        <div className="px-3 py-3 border-b border-border flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">Gladius OS</span>
          <div className="flex items-center gap-1">
            <button
              className="p-1 rounded hover:bg-black/[0.04] text-muted-foreground hover:text-foreground transition-colors"
              title="Search (/)"
              onClick={() => setTab('search')}
            >
              <SearchIcon className="h-4 w-4" />
            </button>
            <NotificationsBell onClick={() => setDrawerOpen(true)} />
          </div>
        </div>
        <NotificationsDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
        <div className="py-3 flex-1 overflow-y-auto">
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
                <item.icon className={`w-3.5 h-3.5 flex-shrink-0 ${tab === item.id ? 'text-primary' : 'text-muted-foreground'}`} />
                {item.label}
              </button>
            </div>
          ))}
        </div>

        {/* User footer */}
        <div className="border-t border-border px-3 py-3 mt-auto">
          <div className="text-xs text-foreground truncate">{user?.display_name}</div>
          <div className="text-xs text-muted-foreground truncate">{user?.email}</div>
          <button
            onClick={handleLogout}
            className="mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign out
          </button>
        </div>
      </nav>
    </div>
  )
}
