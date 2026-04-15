import { useState, useEffect } from 'react'
import { Bug, Sparkles, CheckSquare, Layers, FolderKanban, Headphones, AlertTriangle, FileText } from 'lucide-react'
import { formatElapsed } from '@/lib/utils'

const SERVICE_CLASS_CONFIG = {
  expedite:   { label: 'Expedite',   color: '#A33A25', bg: '#A33A2518' },
  fixed_date: { label: 'Fixed Date', color: '#9A7318', bg: '#9A731818' },
  standard:   { label: 'Standard',   color: '#1E5C3A', bg: '#1E5C3A18' },
  deferred:   { label: 'Deferred',   color: '#6A6460', bg: '#6A646018' },
}

const TYPE_ICON_MAP = {
  'Bug':              Bug,
  'Feature':          Sparkles,
  'Task':             CheckSquare,
  'Epic':             Layers,
  'Project':          FolderKanban,
  'Service Request':  Headphones,
  'Incident':         AlertTriangle,
}
const DEFAULT_TYPE_ICON = FileText

function formatDueDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  const now = new Date()
  const diff = Math.ceil((d - now) / (1000 * 60 * 60 * 24))
  const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const overdue = diff < 0
  const urgent = diff >= 0 && diff <= 3
  return { label, overdue, urgent }
}

export function WorkItemCard({ item, onClick, onPull, isSelected }) {
  const [stageTime, setStageTime] = useState(() => formatElapsed(item.entered_current_stage_at))
  const [totalTime, setTotalTime] = useState(() => formatElapsed(item.created_at))

  useEffect(() => {
    setStageTime(formatElapsed(item.entered_current_stage_at))
    setTotalTime(formatElapsed(item.created_at))
    const id = setInterval(() => {
      setStageTime(formatElapsed(item.entered_current_stage_at))
      setTotalTime(formatElapsed(item.created_at))
    }, 60_000)
    return () => clearInterval(id)
  }, [item.entered_current_stage_at, item.created_at])

  const cos = SERVICE_CLASS_CONFIG[item.derived_service_class] || SERVICE_CLASS_CONFIG.standard
  const isBlocked = item.current_substate === 'blocked'
  const isWaiting = item.current_substate === 'waiting'
  const isPersonal = !item.owner_org_id
  const cornerRadius = isPersonal ? 'rounded-lg' : 'rounded-sm'
  const due = formatDueDate(item.due_date)
  const showPull = onPull && isWaiting

  return (
    <button
      data-item-id={item.id}
      onClick={() => onClick(item)}
      className={`group relative w-full text-left p-2 flex flex-col gap-0.5 transition-colors ${cornerRadius}`}
      style={{
        backgroundColor: isSelected ? 'hsl(var(--primary) / 0.06)' : '#FFFFFF',
        border: isSelected ? '2px solid hsl(var(--primary))' : isBlocked ? '2px solid hsl(var(--destructive) / 0.4)' : '1px solid #D4D4D4',
        padding: (isSelected || isBlocked) ? '7px' : undefined,
      }}
    >
      {/* Pull arrow button (waiting items only) */}
      {showPull && (
        <span
          onClick={e => { e.stopPropagation(); onPull() }}
          className="absolute top-1 right-1 w-5 h-5 rounded flex items-center justify-center text-xs bg-primary/10 text-primary opacity-0 group-hover:opacity-100 transition-opacity hover:bg-primary/20 cursor-pointer"
          title="Pull to active"
        >
          →
        </span>
      )}

      {/* Row 1: icon + title + assignee */}
      <div className="flex items-start gap-1.5 min-w-0">
        {(() => {
          const TypeIcon = TYPE_ICON_MAP[item.work_item_type_class_name] || DEFAULT_TYPE_ICON
          return <TypeIcon className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" title={item.work_item_type_name} />
        })()}
        <p className="text-xs font-medium leading-snug truncate flex-1">
          {item.title}
        </p>
        {item.owner_initial && (
          <span
            className="w-5 h-5 rounded-full bg-muted text-xs flex items-center justify-center flex-shrink-0 text-muted-foreground"
            title={item.owner_display_name}
          >
            {item.owner_initial}
          </span>
        )}
      </div>

      {/* Row 2: merged timer + display key */}
      <div className="flex items-center justify-between">
        <span className="text-xs tabular-nums text-muted-foreground" title={`${stageTime} in stage · ${totalTime} total`}>
          {stageTime} <span className="text-muted-foreground/40">·</span> <span className="text-muted-foreground/50">{totalTime}</span>
        </span>
        {item.display_key && (
          <span className="text-xs text-muted-foreground/50">{item.display_key}</span>
        )}
      </div>

      {/* Row 3: due date (only for fixed-date items) */}
      {due && (
        <div className="flex items-center justify-end">
          <span className={`text-xs ${due.overdue ? 'text-destructive font-medium' : due.urgent ? 'text-amber-600' : 'text-muted-foreground'}`}>
            {due.overdue ? 'overdue · ' : ''}{due.label}
          </span>
        </div>
      )}
    </button>
  )
}
