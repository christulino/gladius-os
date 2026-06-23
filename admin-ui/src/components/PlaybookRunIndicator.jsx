import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'

function formatAgo(ts) {
  if (!ts) return ''
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ago`
}

export default function PlaybookRunIndicator({ workItemId, stageId }) {
  const [run, setRun] = useState(undefined) // undefined=loading, null=none, obj=run
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!workItemId) return
    let cancelled = false
    api.playbookRuns(workItemId).then(data => {
      if (cancelled) return
      const forStage = (data.runs || []).filter(r => r.stage_id === stageId)
      setRun(forStage.length > 0 ? forStage[0] : null)
    }).catch(() => setRun(null))
    return () => { cancelled = true }
  }, [workItemId, stageId, tick])

  // Poll while a run is in-flight so the UI updates when it completes
  useEffect(() => {
    if (!run || run.status !== 'running') return
    const id = setInterval(() => setTick(t => t + 1), 8000)
    return () => clearInterval(id)
  }, [run?.status])

  if (run === undefined) return null
  if (run === null) return null

  if (run.status === 'running') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        Playbook running…
      </div>
    )
  }

  if (run.status === 'failed') {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5 text-xs text-destructive">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-destructive" />
          Playbook failed · {formatAgo(run.completed_at)}
        </div>
        {run.error_message && (
          <span className="text-xs text-muted-foreground pl-3">{run.error_message}</span>
        )}
      </div>
    )
  }

  // success
  const entryLabel = run.entries_written === 1 ? '1 entry' : `${run.entries_written} entries`
  const tokenLabel = run.output_tokens ? ` · ${run.output_tokens} tok` : ''
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />
      Playbook ran {formatAgo(run.completed_at)} · {entryLabel}{run.entries_written === 0 ? ' (no output)' : ''}{tokenLabel}
    </div>
  )
}
