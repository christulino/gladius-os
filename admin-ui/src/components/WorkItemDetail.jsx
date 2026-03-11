import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import { formatElapsed, formatRelative } from '@/lib/utils'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const SERVICE_CLASS_CONFIG = {
  expedite:   { label: 'Expedite',   color: '#A33A25' },
  fixed_date: { label: 'Fixed Date', color: '#9A7318' },
  standard:   { label: 'Standard',   color: '#1E5C3A' },
  deferred:   { label: 'Deferred',   color: '#6A6460' },
}

export function WorkItemDetail({ workItemId, open, onOpenChange, onChanged }) {
  const [item, setItem] = useState(null)
  const [transitions, setTransitions] = useState([])
  const [comments, setComments] = useState([])
  const [relationships, setRelationships] = useState([])
  const [links, setLinks] = useState([])
  const [tab, setTab] = useState('details')
  const [loading, setLoading] = useState(false)
  const [elapsed, setElapsed] = useState('')

  // Editable state
  const [editTitle, setEditTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [descDraft, setDescDraft] = useState('')
  const [descDirty, setDescDirty] = useState(false)
  const [commentBody, setCommentBody] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [saving, setSaving] = useState(false)

  // Transition
  const [transitionOpen, setTransitionOpen] = useState(false)
  const [reasonPrompt, setReasonPrompt] = useState(null)
  const [reasonText, setReasonText] = useState('')

  // Search + link
  const [linkSearch, setLinkSearch] = useState('')
  const [linkResults, setLinkResults] = useState([])
  const [linkType, setLinkType] = useState('related')
  const [showLinkPanel, setShowLinkPanel] = useState(false)

  const loadData = useCallback(async () => {
    if (!workItemId) return
    setLoading(true)
    try {
      const [wi, trans, cmts, rels, lnks] = await Promise.all([
        api.workItem(workItemId),
        api.workItemTransitions(workItemId),
        api.workItemComments(workItemId),
        api.workItemRelationships(workItemId),
        api.workItemLinks(workItemId),
      ])
      setItem(wi)
      setTransitions(trans.rows || [])
      setComments(cmts.rows || [])
      setRelationships(rels.rows || [])
      setLinks(lnks.rows || [])
      setTitleDraft(wi.title)
      setDescDraft(wi.description || '')
      setDescDirty(false)
    } catch (err) {
      console.error('Failed to load work item detail:', err)
    } finally {
      setLoading(false)
    }
  }, [workItemId])

  useEffect(() => {
    if (open && workItemId) loadData()
  }, [open, workItemId, loadData])

  useEffect(() => {
    if (!item) return
    setElapsed(formatElapsed(item.entered_current_stage_at))
    const id = setInterval(() => setElapsed(formatElapsed(item.entered_current_stage_at)), 60_000)
    return () => clearInterval(id)
  }, [item?.entered_current_stage_at])

  async function saveTitle() {
    if (!titleDraft.trim() || titleDraft === item.title) { setEditTitle(false); return }
    setSaving(true)
    try {
      await api.updateWorkItem(workItemId, { title: titleDraft })
      await loadData()
      onChanged?.()
    } finally { setSaving(false); setEditTitle(false) }
  }

  async function saveDescription() {
    setSaving(true)
    try {
      await api.updateWorkItem(workItemId, { description: descDraft })
      setDescDirty(false)
      await loadData()
      onChanged?.()
    } finally { setSaving(false) }
  }

  async function handleSubstate(substate) {
    setSaving(true)
    try {
      await api.setSubstate(workItemId, substate)
      await loadData()
      onChanged?.()
    } finally { setSaving(false) }
  }

  async function handleTransition(t) {
    if (t.requires_reason) {
      setReasonPrompt(t)
      setReasonText('')
      return
    }
    setSaving(true)
    try {
      await api.transitionWorkItem(workItemId, t.to_stage_id)
      await loadData()
      onChanged?.()
    } finally { setSaving(false); setTransitionOpen(false) }
  }

  async function confirmTransitionWithReason() {
    if (!reasonPrompt) return
    setSaving(true)
    try {
      await api.transitionWorkItem(workItemId, reasonPrompt.to_stage_id, reasonText)
      setReasonPrompt(null)
      await loadData()
      onChanged?.()
    } finally { setSaving(false); setTransitionOpen(false) }
  }

  async function submitComment() {
    if (!commentBody.trim()) return
    setSaving(true)
    try {
      await api.addComment(workItemId, commentBody.trim(), replyTo)
      setCommentBody('')
      setReplyTo(null)
      const cmts = await api.workItemComments(workItemId)
      setComments(cmts.rows || [])
    } finally { setSaving(false) }
  }

  async function searchForLink(q) {
    setLinkSearch(q)
    if (q.length < 2) { setLinkResults([]); return }
    try {
      const res = await api.searchWorkItems(q)
      setLinkResults((res.rows || []).filter(r => r.id !== workItemId))
    } catch { setLinkResults([]) }
  }

  async function createLink(targetId) {
    setSaving(true)
    try {
      await api.addWorkItemLink(workItemId, targetId, linkType)
      setShowLinkPanel(false)
      setLinkSearch('')
      setLinkResults([])
      const lnks = await api.workItemLinks(workItemId)
      setLinks(lnks.rows || [])
      onChanged?.()
    } finally { setSaving(false) }
  }

  async function saveDueDate(val) {
    setSaving(true)
    try {
      await api.updateWorkItem(workItemId, { due_date: val || null })
      await loadData()
      onChanged?.()
    } finally { setSaving(false) }
  }

  async function saveExpedited(val) {
    setSaving(true)
    try {
      await api.updateWorkItem(workItemId, { is_expedited: val })
      await loadData()
      onChanged?.()
    } finally { setSaving(false) }
  }

  async function saveWorkNature(val) {
    setSaving(true)
    try {
      await api.updateWorkItem(workItemId, { work_nature: val })
      await loadData()
      onChanged?.()
    } finally { setSaving(false) }
  }

  if (!item && !loading) return null

  const cos = SERVICE_CLASS_CONFIG[item?.derived_service_class] || SERVICE_CLASS_CONFIG.standard

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent onInteractOutside={e => e.preventDefault()}>
        {loading && !item ? (
          <div className="p-6 flex items-center justify-center">
            <span className="text-xs text-muted-foreground">Loading...</span>
          </div>
        ) : item ? (
          <>
            {/* Header */}
            <SheetHeader>
              <div className="flex items-start gap-2">
                {item.work_item_type_icon && (
                  <span className="text-sm flex-shrink-0 mt-0.5" title={item.work_item_type_name}>{item.work_item_type_icon}</span>
                )}
                <div className="flex-1 min-w-0">
                  {editTitle ? (
                    <input
                      value={titleDraft}
                      onChange={e => setTitleDraft(e.target.value)}
                      onBlur={saveTitle}
                      onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') { setEditTitle(false); setTitleDraft(item.title) } }}
                      className="w-full text-sm font-semibold bg-background border border-border rounded px-2 py-1 focus:outline-none focus:border-primary"
                      autoFocus
                    />
                  ) : (
                    <SheetTitle
                      className="cursor-pointer hover:text-primary transition-colors leading-snug"
                      onClick={() => setEditTitle(true)}
                    >
                      {item.title}
                    </SheetTitle>
                  )}
                </div>
              </div>

              {/* Badges row */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {item.display_key && (
                  <span className="text-xs text-muted-foreground">{item.display_key}</span>
                )}
                <Badge variant="muted">{item.current_stage_name}</Badge>
                <span className="text-xs text-muted-foreground italic">{item.work_item_type_name}</span>
                <span
                  className="text-xs px-1.5 py-0.5 rounded-full"
                  style={{ background: `${cos.color}22`, color: cos.color }}
                >
                  {cos.label}
                </span>
                {item.current_substate === 'blocked' && <Badge variant="amber">blocked</Badge>}
              </div>
            </SheetHeader>

            {/* Tabs */}
            <div className="flex border-b border-border px-4">
              {['details', 'comments'].map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-2 text-xs transition-colors border-b-2 -mb-px ${
                    tab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t === 'details' ? 'Details' : `Comments (${comments.length})`}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-4">
              {tab === 'details' ? (
                <div className="flex flex-col gap-3">
                  {/* Timers */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Stage elapsed</span>
                      <span className="text-sm tabular-nums font-semibold">{elapsed}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Last touched</span>
                      <span className="text-xs text-muted-foreground">{formatRelative(item.updated_at)}</span>
                    </div>
                  </div>

                  {/* Class of Service fields */}
                  <div className="flex flex-col gap-2 pt-3 mt-1 border-t border-border">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Urgency & Scheduling</span>

                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!item.is_expedited}
                          onChange={e => saveExpedited(e.target.checked)}
                          className="accent-destructive"
                          disabled={saving}
                        />
                        <span className="text-xs text-foreground">Expedite</span>
                      </label>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-16">Due date</span>
                      <input
                        type="date"
                        value={item.due_date ? new Date(item.due_date).toISOString().split('T')[0] : ''}
                        onChange={e => saveDueDate(e.target.value)}
                        className="bg-background border border-border rounded text-xs text-foreground px-2 py-1 focus:outline-none focus:border-primary"
                        disabled={saving}
                      />
                      {item.due_date && (
                        <button
                          onClick={() => saveDueDate(null)}
                          className="text-xs text-muted-foreground hover:text-destructive"
                          disabled={saving}
                        >clear</button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-16">Nature</span>
                      <select
                        value={item.work_nature || 'delivery'}
                        onChange={e => saveWorkNature(e.target.value)}
                        className="bg-background border border-border rounded text-xs text-foreground px-2 py-1 focus:outline-none focus:border-primary"
                        disabled={saving}
                      >
                        <option value="delivery">Delivery</option>
                        <option value="improvement">Improvement</option>
                      </select>
                    </div>
                  </div>

                  {/* Description */}
                  <div className="flex flex-col gap-1.5 pt-3 mt-1 border-t border-border">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Description</span>
                    <textarea
                      value={descDraft}
                      onChange={e => { setDescDraft(e.target.value); setDescDirty(true) }}
                      placeholder="Add a description..."
                      rows={3}
                      className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap bg-background border border-border rounded px-2 py-1.5 focus:outline-none focus:border-primary resize-y"
                    />
                    {descDirty && (
                      <Button size="sm" className="self-end" onClick={saveDescription} disabled={saving}>
                        Save
                      </Button>
                    )}
                  </div>

                  {/* Actions bar */}
                  <div className="flex flex-col gap-3 pt-3 mt-1 border-t border-border">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Actions</span>
                    <div className="flex flex-wrap gap-2">
                      {item.current_substate === 'blocked' ? (
                        <Button variant="outline" size="sm" onClick={() => handleSubstate('active')} disabled={saving}>
                          Mark Active
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => handleSubstate('blocked')} disabled={saving}>
                          Mark Blocked
                        </Button>
                      )}

                      {/* Transition dropdown */}
                      <div className="relative">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setTransitionOpen(!transitionOpen)}
                          disabled={saving || transitions.length === 0}
                        >
                          Transition to...
                        </Button>
                        {transitionOpen && (
                          <div className="absolute top-full mt-1 left-0 z-50 bg-card border border-border rounded shadow-lg min-w-[180px] py-1">
                            {transitions.map(t => (
                              <button
                                key={t.id}
                                onClick={() => handleTransition(t)}
                                className="w-full text-left px-3 py-2 text-xs hover:bg-black/[0.03] transition-colors flex items-center gap-2"
                              >
                                <span>{t.transition_label || t.to_stage_name}</span>
                                {t.is_terminal && <Badge variant="muted">terminal</Badge>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowLinkPanel(!showLinkPanel)}
                      >
                        Link Work Item
                      </Button>
                    </div>

                    {/* Reason prompt */}
                    {reasonPrompt && (
                      <div className="flex flex-col gap-2 p-3 border border-border rounded bg-background">
                        <span className="text-xs text-muted-foreground">
                          Reason required for "{reasonPrompt.transition_label || reasonPrompt.to_stage_name}":
                        </span>
                        <input
                          value={reasonText}
                          onChange={e => setReasonText(e.target.value)}
                          className="text-xs bg-card border border-border rounded px-2 py-1.5 focus:outline-none focus:border-primary"
                          placeholder="Enter reason..."
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={confirmTransitionWithReason} disabled={saving || !reasonText.trim()}>
                            Confirm
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setReasonPrompt(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Link panel */}
                    {showLinkPanel && (
                      <div className="flex flex-col gap-2 p-3 border border-border rounded bg-background">
                        <div className="flex gap-2">
                          <select
                            value={linkType}
                            onChange={e => setLinkType(e.target.value)}
                            className="text-xs bg-card border border-border rounded px-2 py-1.5"
                          >
                            <option value="related">Related</option>
                            <option value="parent">Parent</option>
                            <option value="child">Child</option>
                          </select>
                          <input
                            value={linkSearch}
                            onChange={e => searchForLink(e.target.value)}
                            placeholder="Search by title or key..."
                            className="flex-1 text-xs bg-card border border-border rounded px-2 py-1.5 focus:outline-none focus:border-primary"
                            autoFocus
                          />
                        </div>
                        {linkResults.length > 0 && (
                          <div className="max-h-32 overflow-y-auto border border-border rounded">
                            {linkResults.map(r => (
                              <button
                                key={r.id}
                                onClick={() => createLink(r.id)}
                                className="w-full text-left px-3 py-2 text-xs hover:bg-black/[0.03] transition-colors flex items-center gap-2 border-b border-border/30 last:border-0"
                              >
                                <span className="text-xs text-muted-foreground">{r.display_key}</span>
                                <span className="truncate">{r.title}</span>
                                <span className="ml-auto text-xs text-muted-foreground">{r.current_stage_name}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Linked items */}
                  {links.length > 0 && (
                    <div className="flex flex-col gap-2 pt-3 mt-1 border-t border-border">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Linked Items</span>
                      {links.map((l, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <Badge variant="muted">{l.link_type}</Badge>
                          <span className="text-xs text-muted-foreground">{l.display_key}</span>
                          <span className="truncate">{l.title}</span>
                          <span className="ml-auto text-xs text-muted-foreground">{l.current_stage_name}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Relationships */}
                  {relationships.length > 0 && (
                    <div className="flex flex-col gap-2 pt-3 mt-1 border-t border-border">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">People</span>
                      {relationships.map(r => (
                        <div key={r.id} className="flex items-center gap-2 text-xs">
                          <Badge variant="muted">{r.relationship_type.replace(/_/g, ' ')}</Badge>
                          <span>{r.display_name}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* URI */}
                  <div className="flex flex-col gap-1 pt-3 mt-1 border-t border-border">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">URI</span>
                    <span className="text-xs text-muted-foreground/60 break-all">{item.uri}</span>
                  </div>
                </div>
              ) : (
                /* Comments tab */
                <div className="flex flex-col gap-4">
                  {comments.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No comments yet.</span>
                  ) : (
                    comments.map(c => (
                      <div
                        key={c.id}
                        className={`flex flex-col gap-1 ${c.parent_comment_id ? 'ml-6 pl-3 border-l-2 border-border' : ''}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-medium ${c.is_system_generated ? 'italic text-muted-foreground' : 'text-foreground'}`}>
                            {c.author_name || 'System'}
                          </span>
                          <span className="text-xs text-muted-foreground">{formatRelative(c.created_at)}</span>
                        </div>
                        <p className={`text-xs leading-relaxed whitespace-pre-wrap ${c.is_system_generated ? 'italic text-muted-foreground' : 'text-foreground/80'}`}>
                          {c.body}
                        </p>
                        {!c.parent_comment_id && (
                          <button
                            onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}
                            className="text-xs text-muted-foreground hover:text-primary self-start"
                          >
                            reply
                          </button>
                        )}
                      </div>
                    ))
                  )}

                  {/* Comment input */}
                  <div className="flex flex-col gap-2 pt-3 border-t border-border">
                    {replyTo && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          Replying to #{replyTo}
                        </span>
                        <button onClick={() => setReplyTo(null)} className="text-xs text-destructive hover:underline">cancel</button>
                      </div>
                    )}
                    <textarea
                      value={commentBody}
                      onChange={e => setCommentBody(e.target.value)}
                      placeholder="Add a comment..."
                      rows={2}
                      className="text-xs bg-background border border-border rounded px-2 py-1.5 focus:outline-none focus:border-primary resize-y"
                    />
                    <Button
                      size="sm"
                      className="self-end"
                      onClick={submitComment}
                      disabled={saving || !commentBody.trim()}
                    >
                      Post Comment
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
