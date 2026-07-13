import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'

/**
 * Dedicated "cancel work item" affordance for the work-item drawer.
 *
 * Cancellation is the only disposition — there is deliberately no hard delete.
 * The item transitions into the workflow's terminal cancelled-class stage,
 * which records cancelled_at / cancelled_reason / cancelled_by. A reason is
 * required. Inline panel (no modal), terracotta destructive styling.
 *
 * Renders nothing when the current stage has no transition to a cancelled stage.
 */
export function CancelWorkItem({ workItemId, cancelTransition, onCancelled }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  if (!cancelTransition) return null

  async function submit() {
    if (!reason.trim()) return
    setSaving(true)
    try {
      await api.transitionWorkItem(workItemId, cancelTransition.to_stage_id, reason.trim())
      setOpen(false)
      setReason('')
      onCancelled?.()
    } finally {
      setSaving(false)
    }
  }

  function close() {
    setOpen(false)
    setReason('')
  }

  if (!open) {
    return (
      <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
        Cancel work item
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-2 p-3 border border-destructive/30 rounded bg-destructive/[0.03] w-full">
      <span className="text-xs font-medium text-destructive">Cancel this work item</span>
      <span className="text-xs text-muted-foreground">
        The item is retired in place, not deleted — its history is preserved. A reason is required.
      </span>
      <input
        value={reason}
        onChange={e => setReason(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') close() }}
        placeholder="Why is this being cancelled?"
        className="text-xs bg-card border border-border rounded px-2 py-1.5 focus:outline-none focus:border-destructive"
        autoFocus
      />
      <div className="flex gap-2">
        <Button variant="danger" size="sm" onClick={submit} disabled={saving || !reason.trim()}>
          {saving ? 'Cancelling...' : 'Cancel work item'}
        </Button>
        <Button variant="outline" size="sm" onClick={close} disabled={saving}>
          Keep it
        </Button>
      </div>
    </div>
  )
}

export default CancelWorkItem
