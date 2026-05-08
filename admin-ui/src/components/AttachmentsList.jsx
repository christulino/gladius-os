import { Trash2, FileText, Image as ImageIcon, Link as LinkIcon, Download } from 'lucide-react'
import { attachmentDownloadUrl, deleteAttachment } from '../lib/api'
import { Button } from './ui/button'

function formatBytes(n) {
  if (!n && n !== 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function iconFor(att) {
  if (att.kind === 'link') return LinkIcon
  if (att.mime_type?.startsWith('image/')) return ImageIcon
  return FileText
}

export default function AttachmentsList({ workItemId, attachments, currentUserId, isAdmin, onChanged }) {
  if (!attachments?.length) {
    return <div className="text-xs text-muted-foreground">No attachments yet.</div>
  }

  async function handleDelete(att) {
    if (!confirm(`Remove ${att.file_name || att.url_title || att.url}?`)) return
    await deleteAttachment(workItemId, att.id)
    onChanged?.()
  }

  return (
    <ul className="divide-y divide-black/5">
      {attachments.map(att => {
        const Icon = iconFor(att)
        const canDelete = att.uploaded_by_user_id === currentUserId || isAdmin
        const label = att.kind === 'file' ? att.file_name : (att.url_title || att.url)
        const meta = att.kind === 'file'
          ? `${formatBytes(Number(att.file_size_bytes))} · ${att.uploaded_by_name || ''}`
          : (att.uploaded_by_name || '')

        return (
          <li key={att.id} className="flex items-center gap-2 py-2">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              {att.kind === 'file' ? (
                <a
                  className="text-sm hover:underline truncate block"
                  href={attachmentDownloadUrl(workItemId, att.id)}
                  download={att.file_name}
                >
                  {label}
                </a>
              ) : (
                <a
                  className="text-sm hover:underline truncate block"
                  href={att.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {label}
                </a>
              )}
              <div className="text-xs text-muted-foreground truncate">{meta}</div>
            </div>
            {att.kind === 'file' && (
              <a
                className="p-1 rounded hover:bg-black/[0.03]"
                href={attachmentDownloadUrl(workItemId, att.id)}
                download={att.file_name}
                aria-label="Download"
              >
                <Download className="h-4 w-4 text-muted-foreground" />
              </a>
            )}
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
  )
}
