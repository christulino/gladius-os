import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import { formatRelative } from '@/lib/utils'

export function WorkItemHistory({ workItemId }) {
  const [rows, setRows] = useState([])
  const [nextBefore, setNextBefore] = useState(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(() => new Set())

  const load = useCallback(async (before = null) => {
    if (!workItemId) return
    setLoading(true)
    try {
      const result = await api.workItemHistory(workItemId, { before })
      setRows(prev => before ? [...prev, ...(result.rows || [])] : (result.rows || []))
      setNextBefore(result.next_before)
    } finally {
      setLoading(false)
    }
  }, [workItemId])

  useEffect(() => {
    setRows([])
    setNextBefore(null)
    setExpanded(new Set())
    load(null)
  }, [workItemId, load])

  const toggleExpanded = (id) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  if (!loading && rows.length === 0) {
    return <span className="text-xs text-muted-foreground">No activity yet.</span>
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map(row => (
        <HistoryRow
          key={row.id}
          row={row}
          isExpanded={expanded.has(row.id)}
          onToggle={() => toggleExpanded(row.id)}
        />
      ))}
      {nextBefore && (
        <button
          onClick={() => load(nextBefore)}
          disabled={loading}
          className="text-xs text-muted-foreground hover:text-primary self-start"
        >
          {loading ? 'Loading…' : 'Load older'}
        </button>
      )}
      {loading && rows.length === 0 && (
        <span className="text-xs text-muted-foreground">Loading…</span>
      )}
    </div>
  )
}

function HistoryRow({ row, isExpanded, onToggle }) {
  const actorName = row.actor?.display_name || 'System'
  const initials = getInitials(actorName)
  const expandable =
    (row.event_type === 'work_item.edited' && Array.isArray(row.details?.changes) && row.details.changes.length > 0) ||
    (row.event_type === 'work_item.commented' && row.details?.preview) ||
    (row.event_type === 'work_item.transitioned' && row.details?.reason) ||
    (row.event_type === 'context_entry.decision_resolved' && row.details?.preview)

  return (
    <div className="flex gap-2 items-start">
      <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-foreground/70 flex-shrink-0 mt-0.5">
        {initials}
      </div>
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <div className="text-xs text-foreground/90 leading-relaxed">
          <span className="font-medium">{actorName}</span>{' '}
          <span className="text-foreground/80">{row.summary}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{formatRelative(row.occurred_at)}</span>
          {expandable && (
            <button
              onClick={onToggle}
              className="text-xs text-muted-foreground hover:text-primary"
            >
              {isExpanded ? 'hide details' : 'show details'}
            </button>
          )}
        </div>
        {isExpanded && expandable && (
          <div className="mt-1 pl-2 border-l-2 border-border flex flex-col gap-1">
            {row.event_type === 'work_item.edited' && row.details.changes.map((c, i) => (
              <FieldChange key={i} change={c} />
            ))}
            {row.event_type === 'work_item.commented' && (
              <p className="text-xs text-foreground/80 whitespace-pre-wrap">{row.details.preview}</p>
            )}
            {row.event_type === 'context_entry.decision_resolved' && row.details.preview && (
              <p className="text-xs text-foreground/80 whitespace-pre-wrap">{row.details.preview}</p>
            )}
            {row.event_type === 'work_item.transitioned' && row.details.reason && (
              <p className="text-xs text-foreground/80">
                <span className="text-muted-foreground">reason:</span> {row.details.reason}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function FieldChange({ change }) {
  return (
    <div className="text-xs flex flex-wrap gap-x-1.5 gap-y-0.5">
      <span className="text-muted-foreground">{humanField(change.field)}:</span>
      <FieldValue value={change.old} muted />
      <span className="text-muted-foreground">→</span>
      <FieldValue value={change.new} />
    </div>
  )
}

function FieldValue({ value, muted = false }) {
  const cls = muted ? 'text-muted-foreground line-through' : 'text-foreground/90'
  if (value === null || value === undefined || value === '') {
    return <span className={`${cls} italic`}>empty</span>
  }
  if (Array.isArray(value)) {
    return <span className={cls}>{value.join(', ') || 'empty'}</span>
  }
  if (typeof value === 'object') {
    return <span className={cls}>{JSON.stringify(value)}</span>
  }
  const s = String(value)
  return <span className={cls}>{s.length > 80 ? s.slice(0, 79) + '…' : s}</span>
}

function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const FIELD_LABELS = {
  title: 'title',
  description: 'description',
  priority: 'priority',
  tags: 'tags',
  estimate: 'estimate',
  estimate_unit: 'estimate unit',
  due_date: 'due date',
  is_expedited: 'expedited',
  work_nature: 'nature',
  origin: 'origin',
  requester_id: 'requester',
}

function humanField(key) {
  if (!key) return ''
  return FIELD_LABELS[key] || key.replace(/_/g, ' ')
}

export default WorkItemHistory
