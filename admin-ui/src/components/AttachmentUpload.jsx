import { useState } from 'react'
import { Link as LinkIcon } from 'lucide-react'
import { addLinkAttachment } from '../lib/api'
import { Button } from './ui/button'

const INPUT_CLASS = 'w-full bg-background border border-border rounded text-xs text-foreground px-2 py-1.5 focus:outline-none focus:border-primary placeholder:text-muted-foreground/40'

export default function AttachmentUpload({ workItemId, onUploaded }) {
  const [linkMode, setLinkMode] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkTitle, setLinkTitle] = useState('')
  const [error, setError] = useState(null)

  async function handleAddLink() {
    setError(null)
    if (!linkUrl.trim()) return
    try {
      await addLinkAttachment(workItemId, linkUrl.trim(), linkTitle.trim() || null)
      setLinkUrl(''); setLinkTitle(''); setLinkMode(false)
      onUploaded?.()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={() => setLinkMode(v => !v)}>
          <LinkIcon className="h-3.5 w-3.5 mr-1.5" /> Add link
        </Button>
      </div>

      {linkMode && (
        <div className="space-y-1.5 border border-black/5 rounded p-2">
          <input
            type="text"
            placeholder="https://..."
            value={linkUrl}
            onChange={e => setLinkUrl(e.target.value)}
            className={INPUT_CLASS}
          />
          <input
            type="text"
            placeholder="Title (optional)"
            value={linkTitle}
            onChange={e => setLinkTitle(e.target.value)}
            className={INPUT_CLASS}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleAddLink}>Save link</Button>
            <Button size="sm" variant="ghost" onClick={() => setLinkMode(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {error && <div className="text-xs text-destructive">{error}</div>}
    </div>
  )
}
