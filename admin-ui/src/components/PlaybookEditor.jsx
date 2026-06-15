import { useState, useEffect, useRef } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Loader2, ChevronDown, ChevronUp, Sparkles } from 'lucide-react'

const PLACEHOLDER = `---
trigger: on_enter
model: default
context:
  pull: [discovery, acceptance]
  org: [architecture, standards]
  write: [decision, note]
---

Write playbook instructions here in markdown.
The AI agent will receive the above context and follow these instructions.
`.trimStart()

export default function PlaybookEditor({ stageId, orgId, stageName }) {
  const [playbook,     setPlaybook]     = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [content,      setContent]      = useState('')
  const [isActive,     setIsActive]     = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [deleting,     setDeleting]     = useState(false)
  const [saveError,    setSaveError]    = useState(null)

  const [aiOpen,       setAiOpen]       = useState(false)
  const [aiMessage,    setAiMessage]    = useState('')
  const [aiLoading,    setAiLoading]    = useState(false)
  const [aiReply,      setAiReply]      = useState('')
  const [aiError,      setAiError]      = useState(null)

  const textareaRef = useRef(null)

  useEffect(() => {
    if (!stageId) return
    setLoading(true)
    setSaveError(null)
    api.stagePlaybook(stageId)
      .then(data => {
        // GET /stages/:id/playbook returns { rows: [...] }
        const pb = data?.rows?.[0] ?? null
        setPlaybook(pb)
        setContent(pb?.content ?? '')
        setIsActive(pb?.is_active ?? true)
      })
      .catch(() => {
        setPlaybook(null)
        setContent('')
        setIsActive(true)
      })
      .finally(() => setLoading(false))
  }, [stageId])

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      if (playbook) {
        // PATCH returns raw row
        const row = await api.updatePlaybook(orgId, playbook.id, { content, isActive })
        setPlaybook(row)
        setContent(row.content)
        setIsActive(row.is_active)
      } else {
        // POST returns raw row (201)
        const row = await api.createStagePlaybook(stageId, { name: 'default', content })
        setPlaybook(row)
        setContent(row.content)
        setIsActive(row.is_active ?? true)
      }
    } catch (e) {
      setSaveError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!playbook) return
    if (!confirm('Delete this playbook? This cannot be undone.')) return
    setDeleting(true)
    setSaveError(null)
    try {
      await api.deletePlaybook(orgId, playbook.id)
      setPlaybook(null)
      setContent('')
      setIsActive(true)
    } catch (e) {
      setSaveError(e.message || 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  async function handleAiGenerate() {
    if (!aiMessage.trim()) return
    setAiLoading(true)
    setAiError(null)
    setAiReply('')
    try {
      const data = await api.aiAssistPlaybook(orgId, {
        playbookContent: content || null,
        message: `Stage: "${stageName}"\n\n${aiMessage}`,
      })
      setAiReply(data.reply ?? '')
    } catch (e) {
      setAiError(e.message || 'AI request failed')
    } finally {
      setAiLoading(false)
    }
  }

  function handleInsert() {
    if (!aiReply) return
    const sep = content && !content.endsWith('\n') ? '\n\n' : content ? '\n' : ''
    setContent(prev => prev + sep + aiReply)
    setAiReply('')
    setAiMessage('')
    textareaRef.current?.focus()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!playbook && !content) {
    return (
      <div className="flex flex-col items-start gap-3 py-6 px-1">
        <p className="text-xs text-muted-foreground">
          No playbook configured for this stage. Add one to instruct the AI agent
          what to do when work items enter this stage.
        </p>
        <Button
          size="sm"
          className="text-xs"
          onClick={() => setContent(PLACEHOLDER)}
        >
          + Add Playbook
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 py-2">
      {/* Active toggle (only when playbook exists) */}
      {playbook && (
        <label className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Active</span>
          <Switch checked={isActive} onCheckedChange={setIsActive} />
        </label>
      )}

      {/* Main content editor */}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder={PLACEHOLDER}
        rows={14}
        className="w-full bg-background border border-border rounded text-xs text-foreground px-2 py-2 resize-y focus:outline-none focus:border-primary leading-relaxed"
        spellCheck={false}
      />

      {/* Error */}
      {saveError && (
        <span className="text-xs text-destructive">{saveError}</span>
      )}

      {/* Save / Delete row */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="text-xs"
          onClick={handleSave}
          disabled={saving || deleting}
        >
          {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
          {playbook ? 'Save' : 'Create Playbook'}
        </Button>
        {playbook && (
          <Button
            size="sm"
            variant="ghost"
            className="text-xs text-destructive hover:text-destructive"
            onClick={handleDelete}
            disabled={saving || deleting}
          >
            {deleting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Delete
          </Button>
        )}
      </div>

      {/* AI Assistant panel */}
      <div className="border-t border-border/60 pt-3 mt-1">
        <button
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
          onClick={() => setAiOpen(v => !v)}
        >
          <Sparkles className="h-3 w-3 flex-shrink-0" />
          <span>AI Assistant</span>
          {aiOpen
            ? <ChevronUp className="h-3 w-3 ml-auto" />
            : <ChevronDown className="h-3 w-3 ml-auto" />
          }
        </button>

        {aiOpen && (
          <div className="flex flex-col gap-2 mt-2">
            <textarea
              value={aiMessage}
              onChange={e => setAiMessage(e.target.value)}
              placeholder={`E.g. "Write a discovery playbook that pulls acceptance criteria and writes a decision entry"`}
              rows={3}
              className="w-full bg-background border border-border rounded text-xs text-foreground px-2 py-1.5 resize-none focus:outline-none focus:border-primary"
            />
            <Button
              size="sm"
              variant="outline"
              className="text-xs self-start"
              onClick={handleAiGenerate}
              disabled={aiLoading || !aiMessage.trim()}
            >
              {aiLoading
                ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Generating…</>
                : 'Generate'
              }
            </Button>

            {aiError && (
              <span className="text-xs text-destructive">{aiError}</span>
            )}

            {aiReply && (
              <div className="flex flex-col gap-2">
                <pre className="text-xs bg-muted/40 border border-border rounded px-2 py-2 whitespace-pre-wrap break-words leading-relaxed max-h-48 overflow-y-auto">
                  {aiReply}
                </pre>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs self-start"
                  onClick={handleInsert}
                >
                  Insert into playbook
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
