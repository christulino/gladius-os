import { useApi } from '@/hooks/useApi'
import { api }    from '@/lib/api'
import { LoadingState, ErrorState } from '@/components/Panel'

function StatCard({ label, value, sub, valueColor = 'text-primary' }) {
  return (
    <div className="bg-card border border-border rounded-md p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">{label}</div>
      <div className={`text-3xl leading-none ${valueColor}`}>{value ?? '—'}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1.5">{sub}</div>}
    </div>
  )
}

export default function Summary() {
  const { data, loading, error } = useApi(() => api.summary())

  if (loading) return <LoadingState />
  if (error)   return <ErrorState message={error} />

  const wi = data.work_items

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      <StatCard label="Organizations"  value={data.orgs} />
      <StatCard label="Users"          value={data.users} />
      <StatCard
        label="Work Items"
        value={wi?.total}
        sub={`${wi?.active} active · ${wi?.pending} pending`}
      />
      <StatCard
        label="Done / Cancelled"
        value={wi?.done}
        valueColor="text-muted-foreground"
        sub={`${wi?.cancelled} cancelled`}
      />
      <StatCard label="Workflows"      value={data.workflows} />
      <StatCard label="Transitions"    value={data.transitions} />
      <StatCard
        label="Sync Queue"
        value={data.sync_queue_depth}
        valueColor={data.sync_queue_depth > 0 ? 'text-orange-400' : 'text-muted-foreground'}
        sub="pending"
      />
    </div>
  )
}
