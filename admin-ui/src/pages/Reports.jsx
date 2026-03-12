import { useState, useMemo } from 'react'
import { useApi } from '@/hooks/useApi'
import { api } from '@/lib/api'
import { OrgSelector } from '@/components/OrgSelector'
import { Panel, PanelHeader, PanelTitle, LoadingState, ErrorState } from '@/components/Panel'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, Legend,
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

const CHART_COLORS = ['#2B6645', '#356D91', '#AD7B1A', '#A33A25', '#7A5535', '#6A6460', '#4A7C59', '#5B8BA8']

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
  { id: 'delivery',   label: 'Delivery Time' },
  { id: 'throughput', label: 'Throughput' },
  { id: 'cycletime',  label: 'Cycle Time by Stage' },
]

// ─── Delivery Time Histogram ─────────────────────────────────────────────────

function DeliveryTimeReport({ orgId, witType, days }) {
  const params = { days }
  if (orgId) params.org_id = orgId
  if (witType) params.wit_type = witType

  const { data, loading, error } = useApi(
    () => api.reportDeliveryTime(params),
    [orgId, witType, days]
  )

  const chartData = useMemo(() => {
    if (!data?.rows?.length) return []
    // Bucket by lead time ranges
    const buckets = [
      { label: '<1d',    min: 0,   max: 24 },
      { label: '1-3d',   min: 24,  max: 72 },
      { label: '3-7d',   min: 72,  max: 168 },
      { label: '1-2w',   min: 168, max: 336 },
      { label: '2-4w',   min: 336, max: 672 },
      { label: '4w+',    min: 672, max: Infinity },
    ]
    return buckets.map(b => ({
      name: b.label,
      count: data.rows.filter(r => r.lead_time_hours >= b.min && r.lead_time_hours < b.max).length,
    }))
  }, [data])

  const stats = useMemo(() => {
    if (!data?.rows?.length) return null
    const hours = data.rows.map(r => r.lead_time_hours).sort((a, b) => a - b)
    const avg = hours.reduce((s, h) => s + h, 0) / hours.length
    const median = hours[Math.floor(hours.length / 2)]
    const p85 = hours[Math.floor(hours.length * 0.85)]
    return { avg, median, p85, total: hours.length }
  }, [data])

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  return (
    <div className="flex flex-col gap-4">
      {/* Stats row */}
      {stats && (
        <div className="flex items-center gap-6">
          <Stat label="Items Delivered" value={stats.total} />
          <Stat label="Avg Lead Time" value={formatHours(stats.avg)} />
          <Stat label="Median" value={formatHours(stats.median)} />
          <Stat label="85th Percentile" value={formatHours(stats.p85)} />
        </div>
      )}

      {/* Chart */}
      {chartData.length > 0 ? (
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(35 20% 70% / 0.4)" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="hsl(28 16% 38%)" />
              <YAxis tick={{ fontSize: 12 }} stroke="hsl(28 16% 38%)" allowDecimals={false} />
              <Tooltip
                contentStyle={{ fontSize: 12, background: '#F6F2EB', border: '1px solid #BDB3A0', borderRadius: 4 }}
                formatter={(v) => [v, 'Items']}
              />
              <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                {chartData.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[0]} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <Empty message="No completed items in this time period." />
      )}
    </div>
  )
}

// ─── Throughput Report ───────────────────────────────────────────────────────

function ThroughputReport({ orgId, witType, days }) {
  const bucket = days <= 14 ? 'day' : days <= 90 ? 'week' : 'month'
  const params = { days, bucket }
  if (orgId) params.org_id = orgId
  if (witType) params.wit_type = witType

  const { data, loading, error } = useApi(
    () => api.reportThroughput(params),
    [orgId, witType, days]
  )

  const { chartData, typeNames } = useMemo(() => {
    if (!data?.rows?.length) return { chartData: [], typeNames: [] }
    // Group by period, stack by type
    const periods = {}
    const types = new Set()
    for (const row of data.rows) {
      const key = new Date(row.period).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      if (!periods[key]) periods[key] = { name: key }
      periods[key][row.work_item_type_name] = row.count
      types.add(row.work_item_type_name)
    }
    return { chartData: Object.values(periods), typeNames: [...types].sort() }
  }, [data])

  const totalItems = useMemo(() => {
    if (!data?.rows?.length) return 0
    return data.rows.reduce((s, r) => s + r.count, 0)
  }, [data])

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-6">
        <Stat label="Total Completed" value={totalItems} />
        <Stat label="Period" value={`${days} days (${bucket}ly buckets)`} />
      </div>

      {chartData.length > 0 ? (
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(35 20% 70% / 0.4)" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="hsl(28 16% 38%)" />
              <YAxis tick={{ fontSize: 12 }} stroke="hsl(28 16% 38%)" allowDecimals={false} />
              <Tooltip
                contentStyle={{ fontSize: 12, background: '#F6F2EB', border: '1px solid #BDB3A0', borderRadius: 4 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {typeNames.map((name, i) => (
                <Bar key={name} dataKey={name} stackId="a" fill={CHART_COLORS[i % CHART_COLORS.length]} radius={i === typeNames.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <Empty message="No completed items in this time period." />
      )}
    </div>
  )
}

// ─── Cycle Time by Stage ─────────────────────────────────────────────────────

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
    return data.rows.map(r => ({
      name: r.stage_name,
      avg: Math.round((r.avg_hours || 0) * 10) / 10,
      median: Math.round((r.median_hours || 0) * 10) / 10,
      p85: Math.round((r.p85_hours || 0) * 10) / 10,
      items: r.item_count,
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
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(28 16% 38%)" label={{ value: 'Hours', angle: -90, position: 'insideLeft', style: { fontSize: 12 } }} />
                <Tooltip
                  contentStyle={{ fontSize: 12, background: '#F6F2EB', border: '1px solid #BDB3A0', borderRadius: 4 }}
                  formatter={(v, name) => [formatHours(v), name === 'avg' ? 'Average' : name === 'median' ? 'Median' : '85th %ile']}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => v === 'avg' ? 'Average' : v === 'median' ? 'Median' : '85th %ile'} />
                <Bar dataKey="median" fill={CHART_COLORS[1]} radius={[3, 3, 0, 0]} />
                <Bar dataKey="avg" fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} />
                <Bar dataKey="p85" fill={CHART_COLORS[2]} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Data table */}
          <div className="border border-border rounded-md overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/30 border-b border-border">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground uppercase tracking-wide">Stage</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground uppercase tracking-wide">Items</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground uppercase tracking-wide">Avg</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground uppercase tracking-wide">Median</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground uppercase tracking-wide">85th %ile</th>
                </tr>
              </thead>
              <tbody>
                {chartData.map(row => (
                  <tr key={row.name} className="border-b border-border/40 hover:bg-black/[0.03]">
                    <td className="px-3 py-1.5 font-medium">{row.name}</td>
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

// ─── Shared UI pieces ────────────────────────────────────────────────────────

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
  const [activeTab, setActiveTab] = useState('delivery')
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

        <select
          value={selectedDays}
          onChange={e => setSelectedDays(parseInt(e.target.value))}
          className="bg-card border border-border rounded px-2 py-1.5 text-xs text-foreground hover:border-primary/50 transition-colors"
        >
          {TIME_PERIODS.map(p => (
            <option key={p.days} value={p.days}>{p.label}</option>
          ))}
        </select>

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
        {activeTab === 'delivery' && (
          <DeliveryTimeReport orgId={selectedOrgId} witType={witTypeFilter || null} days={selectedDays} />
        )}
        {activeTab === 'throughput' && (
          <ThroughputReport orgId={selectedOrgId} witType={witTypeFilter || null} days={selectedDays} />
        )}
        {activeTab === 'cycletime' && (
          <CycleTimeReport orgId={selectedOrgId} witType={witTypeFilter || null} days={selectedDays} />
        )}
      </div>
    </Panel>
  )
}
