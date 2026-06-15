import { useState } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Loader2, ChevronDown, ChevronUp, Sparkles } from 'lucide-react'

export default function PlaybookAiAssistant({ orgId, stageName, playbookContent, onInsert }) {
  const [open,    setOpen]    = useState(false)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [reply,   setReply]   = useState('')
  const [error,   setError]   = useState(null)

  async function generate() {
    if (!message.trim()) return
    setLoading(true)
    setError(null)
    setReply('')
    try {
      const data = await api.aiAssistPlaybook(orgId, {
        playbookContent: playbookContent || null,
        message: `Stage: "${stageName}"\n\n${message}`,
      })
      setReply(data.reply ?? '')
    } catch (e) {
      setError(e.message || 'AI request failed')
    } finally {
      setLoading(false)
    }
  }

  function insert() {
    if (!reply) return
    onInsert(reply)
    setReply('')
    setMessage('')
  }

  return (
    <div className="border-t border-border/60 pt-3 mt-1">
      <button
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
        onClick={() => setOpen(v => !v)}
      >
        <Sparkles className="h-3 w-3 flex-shrink-0" />
        <span>AI Assistant</span>
        {open ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
      </button>

      {open && (
        <div className="flex flex-col gap-2 mt-2">
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder={`E.g. "Write a discovery playbook that pulls acceptance criteria and writes a decision entry"`}
            rows={3}
            className="w-full bg-background border border-border rounded text-xs text-foreground px-2 py-1.5 resize-none focus:outline-none focus:border-primary"
          />
          <Button
            size="sm"
            variant="outline"
            className="text-xs self-start"
            onClick={generate}
            disabled={loading || !message.trim()}
          >
            {loading ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Generating…</> : 'Generate'}
          </Button>

          {error && <span className="text-xs text-destructive">{error}</span>}

          {reply && (
            <div className="flex flex-col gap-2">
              <pre className="text-xs bg-muted/40 border border-border rounded px-2 py-2 whitespace-pre-wrap break-words leading-relaxed max-h-48 overflow-y-auto">
                {reply}
              </pre>
              <Button size="sm" variant="outline" className="text-xs self-start" onClick={insert}>
                Insert into playbook
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
