import { useState, useEffect, useRef } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Loader2 } from 'lucide-react'
import PlaybookAiAssistant from './PlaybookAiAssistant'

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
  const [playbook,        setPlaybook]        = useState(null)
  const [loading,         setLoading]         = useState(true)
  const [content,         setContent]         = useState('')
  const [isActive,        setIsActive]        = useState(true)
  const [executionOwner,  setExecutionOwner]  = useState('in_server')
  const [saving,          setSaving]          = useState(false)
  const [deleting,        setDeleting]        = useState(false)
  const [saveError,       setSaveError]       = useState(null)

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
        setExecutionOwner(pb?.execution_owner ?? 'in_server')
      })
      .catch(() => {
        setPlaybook(null)
        setContent('')
        setIsActive(true)
        setExecutionOwner('in_server')
      })
      .finally(() => setLoading(false))
  }, [stageId])

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      if (playbook) {
        // PATCH returns raw row
        const row = await api.updatePlaybook(orgId, playbook.id, { content, isActive, execution_owner: executionOwner })
        setPlaybook(row)
        setContent(row.content)
        setIsActive(row.is_active)
        setExecutionOwner(row.execution_owner ?? 'in_server')
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
      setExecutionOwner('in_server')
    } catch (e) {
      setSaveError(e.message || 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  function handleInsert(text) {
    const sep = content && !content.endsWith('\n') ? '\n\n' : content ? '\n' : ''
    setContent(prev => prev + sep + text)
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

      {/* Execution owner toggle (only when playbook exists) */}
      {playbook && (
        <div className="flex flex-col gap-1 mt-1">
          <span className="text-xs text-muted-foreground font-medium">Execution owner</span>
          <div className="flex gap-3">
            {[
              { value: 'in_server', label: 'In-server' },
              { value: 'agent',     label: 'Agent' },
            ].map(opt => (
              <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer text-xs">
                <input
                  type="radio"
                  name="execution_owner"
                  value={opt.value}
                  checked={executionOwner === opt.value}
                  onChange={() => setExecutionOwner(opt.value)}
                  className="accent-primary"
                />
                {opt.label}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {executionOwner === 'agent'
              ? 'External agent runs this playbook. In-server executor will skip.'
              : 'In-server executor fires automatically on stage entry.'}
          </p>
        </div>
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

      <PlaybookAiAssistant
        orgId={orgId}
        stageName={stageName}
        playbookContent={content}
        onInsert={handleInsert}
      />
    </div>
  )
}
