import { useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { api } from '@/lib/api'
import { Panel, PanelHeader, PanelTitle, PanelMeta, LoadingState, ErrorState, EmptyState } from '@/components/Panel'
import { BookOpen, AlertCircle, Cpu, CheckCircle2, XCircle, Clock } from 'lucide-react'

// ─── Helpers ────────────────────────────────────────────────────────────────

function relativeTime(iso) {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)   return 'just now'
  if (m < 60)  return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)  return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function truncate(text, max = 120) {
  if (!text) return ''
  return text.length > max ? text.slice(0, max) + '…' : text
}

const TYPE_LABELS = {
  nfr:        'NFR',
  discovery:  'Discovery',
  acceptance: 'Acceptance',
  design:     'Design',
  decision:   'Decision',
  note:       'Note',
  'test-plan':'Test Plan',
  playbook:   'Playbook',
}

const TYPE_COLORS = {
  nfr:        'bg-orange-100 text-orange-700',
  discovery:  'bg-blue-100 text-blue-700',
  acceptance: 'bg-green-100 text-green-700',
  design:     'bg-purple-100 text-purple-700',
  decision:   'bg-amber-100 text-amber-700',
  note:       'bg-muted text-muted-foreground',
  'test-plan':'bg-cyan-100 text-cyan-700',
  playbook:   'bg-indigo-100 text-indigo-700',
}

function TypeBadge({ type }) {
  const label = TYPE_LABELS[type] ?? type
  const color = TYPE_COLORS[type] ?? 'bg-muted text-muted-foreground'
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${color}`}>
      {label}
    </span>
  )
}

// ─── Sub-widgets ─────────────────────────────────────────────────────────────

function JournalWidget({ rows, setTab }) {
  return (
    <Panel className="flex flex-col">
      <PanelHeader>
        <div className="flex items-center gap-2">
          <BookOpen className="w-3.5 h-3.5 text-primary" />
          <PanelTitle>Recent Journal Activity</PanelTitle>
        </div>
        <PanelMeta>{rows.length} entries</PanelMeta>
      </PanelHeader>

      {rows.length === 0
        ? <EmptyState message="No journal entries yet" />
        : (
          <ul className="divide-y divide-border overflow-y-auto">
            {rows.map(entry => (
              <li key={entry.id} className="px-4 py-2.5 hover:bg-black/[0.02] transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <button
                        onClick={() => setTab('workitems')}
                        className="text-xs font-medium text-primary hover:underline tabular-nums flex-shrink-0"
                      >
                        {entry.display_key}
                      </button>
                      <TypeBadge type={entry.type} />
                      {entry.is_agent && (
                        <span className="text-xs text-muted-foreground/60">agent</span>
                      )}
                    </div>
                    <div className="text-xs text-foreground font-medium leading-snug">
                      {entry.title || truncate(entry.content)}
                    </div>
                    {entry.title && (
                      <div className="text-xs text-muted-foreground mt-0.5 leading-snug">
                        {truncate(entry.content)}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums flex-shrink-0 pt-0.5">
                    {relativeTime(entry.created_at)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )
      }
    </Panel>
  )
}

function DecisionsWidget({ rows, setTab }) {
  return (
    <Panel className="flex flex-col">
      <PanelHeader>
        <div className="flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
          <PanelTitle>Open Decisions</PanelTitle>
        </div>
        <PanelMeta>{rows.length} unresolved</PanelMeta>
      </PanelHeader>

      {rows.length === 0
        ? <EmptyState message="No open decisions" />
        : (
          <ul className="divide-y divide-border overflow-y-auto">
            {rows.map(entry => (
              <li key={entry.id} className="px-4 py-2.5 hover:bg-black/[0.02] transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <button
                        onClick={() => setTab('workitems')}
                        className="text-xs font-medium text-primary hover:underline tabular-nums flex-shrink-0"
                      >
                        {entry.display_key}
                      </button>
                      <span className="text-xs text-muted-foreground truncate">
                        {entry.work_item_title}
                      </span>
                    </div>
                    <div className="text-xs text-foreground font-medium leading-snug">
                      {entry.title || truncate(entry.content)}
                    </div>
                    {entry.title && (
                      <div className="text-xs text-muted-foreground mt-0.5 leading-snug">
                        {truncate(entry.content)}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums flex-shrink-0 pt-0.5">
                    {relativeTime(entry.created_at)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )
      }
    </Panel>
  )
}

function RunStatusIcon({ status }) {
  if (status === 'success') return <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
  if (status === 'failed')  return <XCircle      className="w-3.5 h-3.5 text-destructive flex-shrink-0" />
  return                           <Clock        className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 animate-pulse" />
}

function PlaybookRunsWidget({ rows, setTab }) {
  return (
    <Panel className="flex flex-col">
      <PanelHeader>
        <div className="flex items-center gap-2">
          <Cpu className="w-3.5 h-3.5 text-primary" />
          <PanelTitle>Recent Playbook Runs</PanelTitle>
        </div>
        <PanelMeta>{rows.length} runs</PanelMeta>
      </PanelHeader>

      {rows.length === 0
        ? <EmptyState message="No playbook runs yet" />
        : (
          <ul className="divide-y divide-border overflow-y-auto">
            {rows.map(run => (
              <li key={run.id} className="px-4 py-2.5 hover:bg-black/[0.02] transition-colors">
                <div className="flex items-start gap-2">
                  <RunStatusIcon status={run.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <button
                        onClick={() => setTab('workitems')}
                        className="text-xs font-medium text-primary hover:underline tabular-nums flex-shrink-0"
                      >
                        {run.display_key}
                      </button>
                      <span className="text-xs text-muted-foreground">{run.stage_name}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="truncate">{run.work_item_title}</span>
                      {run.model && <span className="flex-shrink-0 tabular-nums">{run.model}</span>}
                      {run.entries_written != null && (
                        <span className="flex-shrink-0 tabular-nums">{run.entries_written} written</span>
                      )}
                    </div>
                    {run.error_message && (
                      <div className="mt-0.5 text-xs text-destructive">{truncate(run.error_message, 80)}</div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums flex-shrink-0 pt-0.5">
                    {relativeTime(run.started_at)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )
      }
    </Panel>
  )
}

// ─── Org selector strip ───────────────────────────────────────────────────────

// ─── Main Dashboard page ──────────────────────────────────────────────────────

export default function Dashboard({ setTab }) {
  const [orgId] = useState(null)

  const { data, loading, error, reload } = useApi(
    () => api.dashboard(orgId),
    [orgId],
  )

  if (loading) return <LoadingState />
  if (error)   return <ErrorState message={error} />

  const { recent_journal = [], open_decisions = [], recent_playbook_runs = [] } = data

  return (
    <div className="p-4 flex flex-col gap-4 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold text-foreground">Dashboard</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Journal activity, open decisions, and AI playbook runs across your work
          </p>
        </div>
        <button
          onClick={reload}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-black/[0.04]"
        >
          Refresh
        </button>
      </div>

      {/* 3-column widget grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">
        <JournalWidget       rows={recent_journal}       setTab={setTab} />
        <DecisionsWidget     rows={open_decisions}       setTab={setTab} />
        <PlaybookRunsWidget  rows={recent_playbook_runs} setTab={setTab} />
      </div>
    </div>
  )
}
