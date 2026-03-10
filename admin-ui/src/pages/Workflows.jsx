// Workflows.jsx
import { useApi }   from '@/hooks/useApi'
import { api }      from '@/lib/api'
import { Badge }    from '@/components/ui/badge'
import { LoadingState, ErrorState } from '@/components/Panel'

const CLASS_VARIANT = {
  intake: 'blue', 'in-progress': 'default', review: 'orange',
  done: 'default', cancelled: 'red', queued: 'muted', triage: 'orange', blocked: 'red',
}
const TRANS_VARIANT = { forward: 'default', backward: 'orange', sideways: 'muted' }

export default function Workflows() {
  const { data, loading, error } = useApi(() => api.workflows())
  if (loading) return <LoadingState />
  if (error)   return <ErrorState message={error} />

  return (
    <div className="flex flex-col gap-3">
      {data.rows.map(wf => (
        <div key={wf.id} className="bg-card border border-border rounded-md overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border">
            <Badge variant="blue">v{wf.version}</Badge>
            <span className="font-medium text-sm">{wf.name}</span>
            {wf.description && <span className="text-xs text-muted-foreground">{wf.description}</span>}
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              {wf.stages.length} stages · {wf.transitions.length} transitions
            </span>
          </div>
          {/* Stage flow */}
          <div className="flex flex-wrap items-center gap-1.5 px-4 py-2.5 border-b border-border">
            {wf.stages.map((s, i) => (
              <div key={s.id} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-border text-xs">→</span>}
                <span
                  className={[
                    'font-mono text-[10px] px-2 py-0.5 rounded border',
                    s.is_entry_stage ? 'border-primary text-primary'
                    : s.stage_class === 'done' ? 'border-primary/50 text-primary/70'
                    : s.stage_class === 'cancelled' ? 'border-destructive/50 text-destructive/70'
                    : s.is_terminal ? 'border-border text-muted-foreground'
                    : 'border-border text-muted-foreground',
                  ].join(' ')}
                  title={`class: ${s.stage_class}${s.wip_limit ? ` | WIP: ${s.wip_limit}` : ''}`}
                >
                  {s.name}
                </span>
              </div>
            ))}
          </div>
          {/* Transitions table */}
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-border">
                {['From', 'To', 'Label', 'Kind', 'Requires Reason'].map(h => (
                  <th key={h} className="px-3 py-1.5 text-left text-[10px] uppercase tracking-wider text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {wf.transitions.map(t => (
                <tr key={t.id} className="border-b border-border/50 hover:bg-white/[0.02]">
                  <td className="px-3 py-1.5">{t.from_stage_name}</td>
                  <td className="px-3 py-1.5">{t.to_stage_name}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{t.transition_label ?? '—'}</td>
                  <td className="px-3 py-1.5">
                    <Badge variant={TRANS_VARIANT[t.transition_kind] ?? 'muted'}>{t.transition_kind}</Badge>
                  </td>
                  <td className="px-3 py-1.5">
                    {t.requires_reason ? <Badge variant="orange">yes</Badge> : <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
