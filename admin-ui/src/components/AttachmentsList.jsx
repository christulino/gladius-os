import { useState } from 'react'
import { Trash2, FileText, Link as LinkIcon } from 'lucide-react'
import { deleteAttachment } from '../lib/api'
import { Button } from './ui/button'

function iconFor(att) {
  return att.kind === 'link' ? LinkIcon : FileText
}

export default function AttachmentsList({ workItemId, attachments, currentUserId, isAdmin, onChanged }) {
  const [error, setError] = useState(null)

  async function handleDelete(att) {
    setError(null)
    if (!confirm(`Remove ${att.url_title || att.url || att.file_name}?`)) return
    try {
      await deleteAttachment(workItemId, att.id)
      onChanged?.()
    } catch (e) {
      setError(e.message || 'Failed to remove attachment')
    }
  }

  if (!attachments?.length) {
    return <div className="text-xs text-muted-foreground">No attachments yet.</div>
  }

  return (
    <>
    <ul className="divide-y divide-black/5">
      {attachments.map(att => {
        const Icon = iconFor(att)
        const canDelete = att.uploaded_by_user_id === currentUserId || isAdmin
        const label = att.kind === 'link' ? (att.url_title || att.url) : att.file_name
        const meta = att.uploaded_by_name || ''

        return (
          <li key={att.id} className="flex items-center gap-2 py-2">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              {att.kind === 'link' ? (
                <a
                  className="text-sm hover:underline truncate block"
                  href={att.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {label}
                </a>
              ) : (
                <span className="text-sm truncate block">{label}</span>
              )}
              <div className="text-xs text-muted-foreground truncate">{meta}</div>
            </div>
            {canDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => handleDelete(att)}
                aria-label="Remove attachment"
              >
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            )}
          </li>
        )
      })}
    </ul>
    {error && <div className="text-xs text-destructive mt-1">{error}</div>}
    </>
  )
}
