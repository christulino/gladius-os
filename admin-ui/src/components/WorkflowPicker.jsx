import { useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

// ─── Semantic Stage Class Colors (shared with Board) ────────────────────────
const STAGE_CLASS_COLORS = {
  'intake':      { bg: '#DBEAFE', text: '#1E40AF', border: '#93C5FD' },
  'triage':      { bg: '#FEF3C7', text: '#92400E', border: '#FCD34D' },
  'queued':      { bg: '#EDE9FE', text: '#5B21B6', border: '#C4B5FD' },
  'in-progress': { bg: '#D1FAE5', text: '#065F46', border: '#6EE7B7' },
  'blocked':     { bg: '#FEE2E2', text: '#991B1B', border: '#FCA5A5' },
  'review':      { bg: '#CCFBF1', text: '#115E59', border: '#5EEAD4' },
  'approved':    { bg: '#E0E7FF', text: '#3730A3', border: '#A5B4FC' },
  'delivery':    { bg: '#E0E7FF', text: '#3730A3', border: '#A5B4FC' },
  'done':        { bg: '#ECFCCB', text: '#3F6212', border: '#BEF264' },
  'cancelled':   { bg: '#F1F5F9', text: '#475569', border: '#CBD5E1' },
}

function StageFlow({ stages }) {
  if (!stages?.length) return <span className="text-xs text-muted-foreground italic">No stages</span>

  const sorted = [...stages].sort((a, b) => a.display_order - b.display_order)

  return (
    <div className="flex items-center gap-0.5 flex-wrap">
      {sorted.map((s, i) => {
        const colors = STAGE_CLASS_COLORS[s.stage_class] || STAGE_CLASS_COLORS['cancelled']
        return (
          <div key={s.id} className="flex items-center gap-0.5">
            {i > 0 && <span className="text-muted-foreground/40 text-[10px]">→</span>}
            <span
              className="text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap"
              style={{ backgroundColor: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}
              title={`${s.name} (${s.stage_class})${s.has_waiting_queue ? ' · waiting queue' : ''}${s.is_terminal ? ' · terminal' : ''}`}
            >
              {s.name}
              {s.has_waiting_queue && <span className="ml-0.5 opacity-60">⧖</span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function WorkflowPicker({ open, onOpenChange, workflows = [], currentWorkflowId, onSelect }) {
  const [hoveredId, setHoveredId] = useState(null)

  const activeWorkflows = workflows.filter(w => w.is_active)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 p-0 w-[480px]">
        <SheetHeader className="px-4 pt-4 pb-3 border-b border-border">
          <SheetTitle className="text-sm font-semibold">Choose Workflow</SheetTitle>
          <p className="text-xs text-muted-foreground">Select a workflow to assign to this work item type</p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {activeWorkflows.length === 0 && (
            <div className="text-xs text-muted-foreground py-8 text-center">No active workflows</div>
          )}

          {activeWorkflows.map(w => {
            const isCurrent = w.id === currentWorkflowId
            const stageCount = w.stages?.length ?? 0
            const transitionCount = w.transitions?.length ?? 0
            const waitingQueues = w.stages?.filter(s => s.has_waiting_queue).length ?? 0

            return (
              <button
                key={w.id}
                className={`w-full text-left px-4 py-3 border-b border-border/50 transition-colors ${
                  isCurrent
                    ? 'bg-primary/5 border-l-2 border-l-primary'
                    : 'hover:bg-black/[0.03]'
                }`}
                onMouseEnter={() => setHoveredId(w.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => { onSelect(w.id); onOpenChange(false) }}
              >
                {/* Row 1: Name + badges */}
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-semibold flex-1">{w.name}</span>
                  {isCurrent && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">Current</span>
                  )}
                  {w.is_system_default && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">System</span>
                  )}
                </div>

                {/* Row 2: Description */}
                {w.description && (
                  <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{w.description}</p>
                )}

                {/* Row 3: Stage flow visualization */}
                <StageFlow stages={w.stages} />

                {/* Row 4: Stats */}
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="text-[10px] text-muted-foreground">{stageCount} stages</span>
                  <span className="text-[10px] text-muted-foreground">{transitionCount} transitions</span>
                  {waitingQueues > 0 && (
                    <span className="text-[10px] text-muted-foreground">{waitingQueues} waiting queues</span>
                  )}
                </div>
              </button>
            )
          })}

          {/* Option to remove workflow */}
          {currentWorkflowId && (
            <button
              className="w-full text-left px-4 py-3 hover:bg-black/[0.03] transition-colors text-xs text-muted-foreground"
              onClick={() => { onSelect(null); onOpenChange(false) }}
            >
              Remove workflow assignment
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
