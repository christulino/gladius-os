import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'

// Status pill shown in a decision entry's header.
export function DecisionStatusBadge({ resolved }) {
  return resolved ? (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#7a9e6e22] text-[#2d5a27] border border-[#2d5a2744] font-semibold uppercase tracking-wide">✓ resolved</span>
  ) : (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#c8a84b22] text-[#7a5c00] border border-[#c8a84b44] font-semibold uppercase tracking-wide">○ open</span>
  )
}

// Resolution footer for decision entries: shows the recorded answer when resolved
// (with a Reopen action), or an inline resolve affordance when open. No modal —
// the resolve form expands in place, per the drawer/inline-only overlay rule.
export function DecisionResolution({ entry, workItemId, onUpdated }) {
  const [resolving, setResolving] = useState(false)
  const [text, setText]           = useState('')
  const [busy, setBusy]           = useState(false)

  async function resolve() {
    setBusy(true)
    try {
      const updated = await api.resolveDecisionEntry(workItemId, entry.id, { resolution_text: text })
      onUpdated?.(updated)
      setResolving(false)
      setText('')
    } finally { setBusy(false) }
  }

  async function reopen() {
    setBusy(true)
    try {
      const updated = await api.reopenDecisionEntry(workItemId, entry.id)
      onUpdated?.(updated)
    } finally { setBusy(false) }
  }

  if (entry.resolved) {
    return (
      <div className="px-3 py-2 border-t border-border bg-[#7a9e6e11]">
        <div className="text-[10px] font-semibold text-[#2d5a27] uppercase tracking-wide mb-1">Resolution</div>
        {entry.resolution_text && (
          <p className="text-xs text-foreground mb-1 whitespace-pre-wrap">{entry.resolution_text}</p>
        )}
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{entry.resolved_at ? `resolved ${new Date(entry.resolved_at).toLocaleDateString()}` : 'resolved'}</span>
          <button onClick={reopen} disabled={busy} className="ml-auto underline hover:text-foreground">
            {busy ? '…' : 'Reopen'}
          </button>
        </div>
      </div>
    )
  }

  if (resolving) {
    return (
      <div className="px-3 py-2 border-t border-border bg-muted/20 flex flex-col gap-2">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          autoFocus
          placeholder="Record the answer…"
          className="w-full text-xs bg-background border border-border rounded p-2 resize-none outline-none min-h-[60px]"
        />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => { setResolving(false); setText('') }}>Cancel</Button>
          <Button size="sm" onClick={resolve} disabled={busy || !text.trim()}>{busy ? 'Resolving…' : 'Resolve'}</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="px-3 py-1.5 border-t border-border flex justify-end">
      <button onClick={() => setResolving(true)} className="text-[10px] font-semibold text-[#2d5a27] hover:opacity-80">
        ✓ Resolve decision
      </button>
    </div>
  )
}
