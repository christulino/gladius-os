import { useState, useEffect } from 'react'
import { formatElapsed } from '@/lib/utils'

export function WorkItemCard({ item, onClick }) {
  const [elapsed, setElapsed] = useState(() => formatElapsed(item.entered_current_stage_at))

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(formatElapsed(item.entered_current_stage_at))
    }, 60_000)
    return () => clearInterval(id)
  }, [item.entered_current_stage_at])

  const accentColor = item.service_class_color || '#6b7280'

  return (
    <button
      onClick={() => onClick(item)}
      className="w-full text-left bg-card border border-border rounded-md p-3 flex flex-col gap-2 hover:border-primary/50 transition-colors"
      style={{ borderLeftColor: accentColor, borderLeftWidth: '3px' }}
    >
      {/* Type label */}
      <div className="flex items-center gap-1.5 min-w-0">
        {item.work_item_type_icon && (
          <span className="text-[11px] flex-shrink-0">{item.work_item_type_icon}</span>
        )}
        <span
          className="font-mono text-[10px] uppercase tracking-wider truncate"
          style={{ color: item.work_item_type_color || 'var(--muted-foreground)' }}
        >
          {item.work_item_type_name}
        </span>
      </div>

      {/* Title */}
      <p className="text-xs text-foreground leading-snug line-clamp-2 font-medium">
        {item.title}
      </p>

      {/* Footer: timer + service class */}
      <div className="flex items-center justify-between gap-2 mt-0.5">
        <span className="font-mono text-[10px] text-muted-foreground tabular-nums">{elapsed}</span>
        {item.service_class_name && (
          <span
            className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
            style={{
              background: `${accentColor}22`,
              color: accentColor,
            }}
          >
            {item.service_class_name}
          </span>
        )}
      </div>
    </button>
  )
}
