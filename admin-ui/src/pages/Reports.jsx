import { useState, useMemo } from 'react'
import { useApi } from '@/hooks/useApi'
import { api } from '@/lib/api'
import { OrgSelector } from '@/components/OrgSelector'
import { Panel, PanelHeader, PanelTitle, LoadingState, ErrorState } from '@/components/Panel'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'

// ─── Shared filter config ────────────────────────────────────────────────────

const TIME_PERIODS = [
  { label: '1 week',    days: 7 },
  { label: '2 weeks',   days: 14 },
  { label: '4 weeks',   days: 28 },
  { label: '6 weeks',   days: 42 },
  { label: '90 days',   days: 90 },
  { label: '6 months',  days: 180 },
  { label: '12 months', days: 365 },
]

// Agent-vs-human is a binary CLASS (never per-user). agent = configured agent
// identity moved the item; human = everyone else incl. system/NULL. See the
// FEAT.26609 design journal entry for the exact classification rule.
const ACTOR_COLORS = { agent: '#356D91', human: '#2B6645' } // map-blue / forest-green
const ACTOR_LABELS = { agent: 'Agent', human: 'Human' }
const TOOLTIP_STYLE = { fontSize: 12, background: '#F6F2EB', border: '1px solid #BDB3A0', borderRadius: 4 }

function formatHours(h) {
  if (h == null || isNaN(h)) return '—'
  if (h < 1) return `${Math.round(h * 60)}m`
  if (h < 24) return `${Math.round(h)}h`
  const d = Math.floor(h / 24)
  const rem = Math.round(h % 24)
  return rem > 0 ? `${d}d ${rem}h` : `${d}d`
}

// ─── Report Tabs ─────────────────────────────────────────────────────────────

const TABS = [
  { id: 'cycletime',  label: 'Cycle Time by Stage' },
  { id: 'aging',      label: 'Aging WIP' },
  { id: 'throughput', label: 'Throughput' },
]

// ─── Cycle Time by Stage (agent vs human) ────────────────────────────────────

function CycleTimeReport({ orgId, witType, days }) {
  const params = { days }
  if (orgId) params.org_id = orgId
  if (witType) params.wit_type = witType

  const { data, loading, error } = useApi(
    () => api.reportCycleTimeByStage(params),
    [orgId, witType, days]
  )

  const chartData = useMemo(() => {
    if (!data?.rows?.length) return []
    const stages = {}
    const order = []
    for (const r of data.rows) {
      if (!stages[r.stage_name]) { stages[r.stage_name] = { name: r.stage_name }; order.push(r.stage_name) }
      stages[r.stage_name][`median_${r.actor_class}`] = Math.round((r.median_hours || 0) * 10) / 10
    }
    return order.map(n => stages[n])
  }, [data])

  const tableRows = useMemo(() => {
    if (!data?.rows?.length) return []
    return data.rows.map(r => ({
      stage: r.stage_name,
      actor: r.actor_class,
      items: r.item_count,
      avg: Math.round((r.avg_hours || 0) * 10) / 10,
      median: Math.round((r.median_hours || 0) * 10) / 10,
      p85: Math.round((r.p85_hours || 0) * 10) / 10,
    }))
  }, [data])

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  return (
    <div className="flex flex-col gap-4">
      {chartData.length > 0 ? (
        <>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(35 20% 70% / 0.4)" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="hsl(28 16% 38%)" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(28 16% 38%)" label={{ value: 'Median hours', angle: -90, position: 'insideLeft', style: { fontSize: 12 } }} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v, k) => [formatHours(v), k === 'median_agent' ? 'Agent' : 'Human']}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => v === 'median_agent' ? 'Agent' : 'Human'} />
                <Bar dataKey="median_human" fill={ACTOR_COLORS.human} radius={[3, 3, 0, 0]} />
                <Bar dataKey="median_agent" fill={ACTOR_COLORS.agent} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Data table — per stage, per actor class */}
          <div className="border border-border rounded-md overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/30 border-b border-border">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wide">Stage</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wide">Actor</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground uppercase tracking-wide">Items</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground uppercase tracking-wide">Avg</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground uppercase tracking-wide">Median</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground uppercase tracking-wide">85th %ile</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row, i) => (
                  <tr key={`${row.stage}-${row.actor}-${i}`} className="border-b border-border/40 hover:bg-black/[0.03]">
                    <td className="px-3 py-1.5 font-medium">{row.stage}</td>
                    <td className="px-3 py-1.5"><ActorTag actor={row.actor} /></td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">{row.items}</td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">{formatHours(row.avg)}</td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">{formatHours(row.median)}</td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">{formatHours(row.p85)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <Empty message="No stage transition data in this time period." />
      )}
    </div>
  )
}

// ─── Aging WIP (agent vs human) ──────────────────────────────────────────────

const AGE_BUCKETS = [
  { label: '<1d',  min: 0,   max: 24 },
  { label: '1-3d', min: 24,  max: 72 },
  { label: '3-7d', min: 72,  max: 168 },
  { label: '1-2w', min: 168, max: 336 },
  { label: '2-4w', min: 336, max: 672 },
  { label: '4w+',  min: 672, max: Infinity },
]

function AgingWipReport({ orgId, witType }) {
  const params = {}
  if (orgId) params.org_id = orgId
  if (witType) params.wit_type = witType

  const { data, loading, error } = useApi(
    () => api.reportAgingWip(params),
    [orgId, witType]
  )

  const chartData = useMemo(() => {
    if (!data?.rows?.length) return []
    return AGE_BUCKETS.map(b => {
      const inBucket = data.rows.filter(r => r.age_hours >= b.min && r.age_hours < b.max)
      return {
        name: b.label,
        agent: inBucket.filter(r => r.actor_class === 'agent').length,
        human: inBucket.filter(r => r.actor_class === 'human').length,
      }
    })
  }, [data])

  const stats = useMemo(() => {
    if (!data?.rows?.length) return null
    const agent = data.rows.filter(r => r.actor_class === 'agent').length
    const human = data.rows.filter(r => r.actor_class === 'human').length
    const oldest = data.rows.reduce((m, r) => Math.max(m, r.age_hours || 0), 0)
    return { total: data.rows.length, agent, human, oldest }
  }, [data])

  // Rows arrive ordered oldest-first from the API; show the leaders.
  const topRows = useMemo(() => (data?.rows || []).slice(0, 12), [data])

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  return (
    <div className="flex flex-col gap-4">
      {stats && (
        <div className="flex items-center gap-6">
          <Stat label="In Progress" value={stats.total} />
          <Stat label="Agent" value={stats.agent} />
          <Stat label="Human" value={stats.human} />
          <Stat label="Oldest" value={formatHours(stats.oldest)} />
        </div>
      )}

      {stats && stats.total > 0 ? (
        <>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(35 20% 70% / 0.4)" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="hsl(28 16% 38%)" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(28 16% 38%)" allowDecimals={false} label={{ value: 'Items', angle: -90, position: 'insideLeft', style: { fontSize: 12 } }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, k) => [v, ACTOR_LABELS[k] || k]} />
                <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => ACTOR_LABELS[v] || v} />
                <Bar dataKey="human" stackId="a" fill={ACTOR_COLORS.human} />
                <Bar dataKey="agent" stackId="a" fill={ACTOR_COLORS.agent} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Oldest in-progress items */}
          <div className="border border-border rounded-md overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/30 border-b border-border">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wide">Item</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wide">Stage</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wide">Actor</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground uppercase tracking-wide">Age in stage</th>
                </tr>
              </thead>
              <tbody>
                {topRows.map(row => (
                  <tr key={row.id} className="border-b border-border/40 hover:bg-black/[0.03]">
                    <td className="px-3 py-1.5">
                      <span className="font-medium">{row.display_key}</span>
                      <span className="text-muted-foreground"> · {row.title}</span>
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">{row.stage_name}</td>
                    <td className="px-3 py-1.5"><ActorTag actor={row.actor_class} /></td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">{formatHours(row.age_hours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <Empty message="No in-progress items right now." />
      )}
    </div>
  )
}

// ─── Throughput (agent vs human) ─────────────────────────────────────────────

function ThroughputReport({ orgId, witType, days }) {
  const bucket = days <= 14 ? 'day' : days <= 90 ? 'week' : 'month'
  const params = { days, bucket }
  if (orgId) params.org_id = orgId
  if (witType) params.wit_type = witType

  const { data, loading, error } = useApi(
    () => api.reportThroughput(params),
    [orgId, witType, days]
  )

  const chartData = useMemo(() => {
    if (!data?.rows?.length) return []
    const periods = {}
    const order = []
    for (const row of data.rows) {
      const key = new Date(row.period).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      if (!periods[key]) { periods[key] = { name: key, agent: 0, human: 0 }; order.push(key) }
      periods[key][row.actor_class] = (periods[key][row.actor_class] || 0) + row.count
    }
    return order.map(k => periods[k])
  }, [data])

  const totals = useMemo(() => {
    const t = { agent: 0, human: 0 }
    for (const row of data?.rows || []) t[row.actor_class] = (t[row.actor_class] || 0) + row.count
    return t
  }, [data])

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-6">
        <Stat label="Total Completed" value={totals.agent + totals.human} />
        <Stat label="Agent" value={totals.agent} />
        <Stat label="Human" value={totals.human} />
        <Stat label="Period" value={`${days} days (${bucket}ly)`} />
      </div>

      {chartData.length > 0 ? (
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(35 20% 70% / 0.4)" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="hsl(28 16% 38%)" />
              <YAxis tick={{ fontSize: 12 }} stroke="hsl(28 16% 38%)" allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, k) => [v, ACTOR_LABELS[k] || k]} />
              <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => ACTOR_LABELS[v] || v} />
              <Bar dataKey="human" stackId="a" fill={ACTOR_COLORS.human} />
              <Bar dataKey="agent" stackId="a" fill={ACTOR_COLORS.agent} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <Empty message="No completed items in this time period." />
      )}
    </div>
  )
}

// ─── Shared UI pieces ────────────────────────────────────────────────────────

function ActorTag({ actor }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block w-2 h-2 rounded-full" style={{ background: ACTOR_COLORS[actor] || '#6A6460' }} />
      <span className="text-muted-foreground">{ACTOR_LABELS[actor] || actor}</span>
    </span>
  )
}

function Stat({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
      <span className="text-sm font-semibold text-foreground">{value}</span>
    </div>
  )
}

function Empty({ message }) {
  return (
    <div className="flex items-center justify-center h-[200px]">
      <span className="text-xs text-muted-foreground">{message}</span>
    </div>
  )
}

// ─── Main Reports Page ───────────────────────────────────────────────────────

export default function Reports() {
  const [activeTab, setActiveTab] = useState('cycletime')
  const [selectedOrgId, setSelectedOrgId] = useState(null)
  const [selectedDays, setSelectedDays] = useState(42)
  const [witTypeFilter, setWitTypeFilter] = useState('')

  const { data: orgsData } = useApi(() => api.organizations(), [])
  const { data: typesData } = useApi(() => api.witTypes(), [])

  const witTypeNames = useMemo(() => {
    if (!typesData?.rows) return []
    const names = new Set(typesData.rows.map(t => t.name))
    return [...names].sort()
  }, [typesData])

  return (
    <Panel className="flex-1 min-h-0">
      <PanelHeader>
        <PanelTitle>Reports</PanelTitle>
      </PanelHeader>

      {/* Tab bar */}
      <div className="flex items-center gap-0 border-b border-border px-4">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 text-xs transition-colors ${
              activeTab === tab.id
                ? 'text-primary border-b-2 border-primary font-medium'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-card">
        {orgsData?.rows?.length > 0 && (
          <OrgSelector
            orgs={orgsData.rows}
            selectedId={selectedOrgId}
            onChange={setSelectedOrgId}
          />
        )}

        {witTypeNames.length > 0 && (
          <select
            value={witTypeFilter}
            onChange={e => setWitTypeFilter(e.target.value)}
            className="bg-card border border-border rounded px-2 py-1.5 text-xs text-foreground hover:border-primary/50 transition-colors"
          >
            <option value="">All types</option>
            {witTypeNames.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        )}

        {/* Aging WIP is a point-in-time snapshot — the time window doesn't apply */}
        {activeTab !== 'aging' && (
          <select
            value={selectedDays}
            onChange={e => setSelectedDays(parseInt(e.target.value))}
            className="bg-card border border-border rounded px-2 py-1.5 text-xs text-foreground hover:border-primary/50 transition-colors"
          >
            {TIME_PERIODS.map(p => (
              <option key={p.days} value={p.days}>{p.label}</option>
            ))}
          </select>
        )}

        {selectedOrgId && (
          <button
            onClick={() => setSelectedOrgId(null)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear org filter
          </button>
        )}
      </div>

      {/* Report content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {activeTab === 'cycletime' && (
          <CycleTimeReport orgId={selectedOrgId} witType={witTypeFilter || null} days={selectedDays} />
        )}
        {activeTab === 'aging' && (
          <AgingWipReport orgId={selectedOrgId} witType={witTypeFilter || null} />
        )}
        {activeTab === 'throughput' && (
          <ThroughputReport orgId={selectedOrgId} witType={witTypeFilter || null} days={selectedDays} />
        )}
      </div>
    </Panel>
  )
}
