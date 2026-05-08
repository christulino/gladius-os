import { useState, useEffect, useCallback, useRef } from 'react'
import { api, auth, notificationsApi, listAttachments } from '@/lib/api'
import { formatElapsed, formatRelative } from '@/lib/utils'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ServiceLibrary } from '@/components/ServiceLibrary'
import { FormDrawer } from '@/components/FormDrawer'
import { WorkItemHistory } from '@/components/WorkItemHistory'
import AttachmentsList from '@/components/AttachmentsList'
import AttachmentUpload from '@/components/AttachmentUpload'
import { Plus, X, Check, CircleDot, Shield, AlertTriangle, Loader2 } from 'lucide-react'

// ─── Custom Fields Renderer ─────────────────────────────────────────────────

function CustomFields({ fields, values, onSave }) {
  const [localValues, setLocalValues] = useState(values || {})
  const [lookupCache, setLookupCache] = useState({})
  const debounceRef = useRef(null)

  useEffect(() => { setLocalValues(values || {}) }, [values])

  // Load lookup list values for fields that reference them
  useEffect(() => {
    if (!fields) return
    const listIds = [...new Set(fields.filter(f => f.lookup_list_id).map(f => f.lookup_list_id))]
    for (const listId of listIds) {
      if (lookupCache[listId]) continue
      api.lookupValues(listId).then(data => {
        setLookupCache(prev => ({ ...prev, [listId]: (data.rows || []).filter(v => v.is_active) }))
      }).catch(() => {})
    }
  }, [fields])

  function update(key, val) {
    const next = { ...localValues, [key]: val }
    setLocalValues(next)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => onSave(next), 600)
  }

  if (!fields || fields.length === 0) return null

  // Group fields by field_group
  const grouped = {}
  for (const f of fields) {
    const g = f.field_group || ''
    if (!grouped[g]) grouped[g] = []
    grouped[g].push(f)
  }

  return (
    <div className="flex flex-col gap-2 pt-3 mt-1 border-t border-border">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Custom Fields</span>
      {Object.entries(grouped).map(([group, gFields]) => (
        <div key={group} className="flex flex-col gap-2">
          {group && (
            <span className="text-xs font-medium text-muted-foreground mt-1">{group}</span>
          )}
          {gFields.map(f => {
            // Resolve options: lookup list takes precedence over inline field_options
            const options = f.lookup_list_id && lookupCache[f.lookup_list_id]
              ? lookupCache[f.lookup_list_id].map(v => ({ label: v.label, value: v.label }))
              : f.field_options || []
            return (
              <FieldInput
                key={f.id}
                field={{ ...f, field_options: options }}
                value={localValues[f.field_key]}
                onChange={val => update(f.field_key, val)}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}

function FieldInput({ field, value, onChange }) {
  const { field_type, field_label, field_key, field_options, is_required } = field

  const labelEl = (
    <span className="text-xs text-muted-foreground w-24 flex-shrink-0">
      {field_label}{is_required && <span className="text-destructive ml-0.5">*</span>}
    </span>
  )

  const inputCls = 'flex-1 text-xs bg-background border border-border rounded px-2 py-1 focus:outline-none focus:border-primary'

  switch (field_type) {
    case 'text':
    case 'url':
      return (
        <div className="flex items-center gap-2">
          {labelEl}
          <input
            type={field_type === 'url' ? 'url' : 'text'}
            value={value ?? ''}
            onChange={e => onChange(e.target.value)}
            placeholder={field_type === 'url' ? 'https://...' : ''}
            className={inputCls}
          />
        </div>
      )

    case 'textarea':
      return (
        <div className="flex flex-col gap-1">
          {labelEl}
          <textarea
            value={value ?? ''}
            onChange={e => onChange(e.target.value)}
            rows={2}
            className="text-xs bg-background border border-border rounded px-2 py-1.5 focus:outline-none focus:border-primary resize-y"
          />
        </div>
      )

    case 'number':
      return (
        <div className="flex items-center gap-2">
          {labelEl}
          <input
            type="number"
            value={value ?? ''}
            onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
            className={inputCls}
          />
        </div>
      )

    case 'boolean':
      return (
        <div className="flex items-center gap-2">
          {labelEl}
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={!!value}
              onChange={e => onChange(e.target.checked)}
              className="accent-primary"
            />
            <span className="text-xs text-foreground">{value ? 'Yes' : 'No'}</span>
          </label>
        </div>
      )

    case 'date':
      return (
        <div className="flex items-center gap-2">
          {labelEl}
          <input
            type="date"
            value={value ?? ''}
            onChange={e => onChange(e.target.value || null)}
            className={inputCls}
          />
        </div>
      )

    case 'select': {
      const options = field_options || []
      return (
        <div className="flex items-center gap-2">
          {labelEl}
          <select
            value={value ?? ''}
            onChange={e => onChange(e.target.value || null)}
            className={inputCls}
          >
            <option value="">—</option>
            {options.map(o => (
              <option key={typeof o === 'string' ? o : o.value} value={typeof o === 'string' ? o : o.value}>
                {typeof o === 'string' ? o : o.label}
              </option>
            ))}
          </select>
        </div>
      )
    }

    case 'multi_select': {
      const options = field_options || []
      const selected = Array.isArray(value) ? value : []
      return (
        <div className="flex flex-col gap-1">
          {labelEl}
          <div className="flex flex-wrap gap-1">
            {options.map(o => {
              const v = typeof o === 'string' ? o : o.value
              const l = typeof o === 'string' ? o : o.label
              const checked = selected.includes(v)
              return (
                <label key={v} className="flex items-center gap-1 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onChange(checked ? selected.filter(s => s !== v) : [...selected, v])}
                    className="accent-primary"
                  />
                  {l}
                </label>
              )
            })}
          </div>
        </div>
      )
    }

    case 'user':
      return (
        <div className="flex items-center gap-2">
          {labelEl}
          <span className="text-xs text-muted-foreground/60">{value || 'Not set'}</span>
        </div>
      )

    case 'org':
      return (
        <div className="flex items-center gap-2">
          {labelEl}
          <span className="text-xs text-muted-foreground/60">{value || 'Not set'}</span>
        </div>
      )

    default:
      return (
        <div className="flex items-center gap-2">
          {labelEl}
          <input
            type="text"
            value={value ?? ''}
            onChange={e => onChange(e.target.value)}
            className={inputCls}
          />
        </div>
      )
  }
}

const SERVICE_CLASS_CONFIG = {
  expedite:   { label: 'Expedite',   color: '#A33A25' },
  fixed_date: { label: 'Fixed Date', color: '#9A7318' },
  standard:   { label: 'Standard',   color: '#1E5C3A' },
  deferred:   { label: 'Deferred',   color: '#6A6460' },
}

export function WorkItemDetail({ workItemId: initialWorkItemId, open, onOpenChange, onChanged }) {
  const [activeId, setActiveId] = useState(initialWorkItemId)
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

  // Exit criteria gate
  const [criteriaGate, setCriteriaGate] = useState(null)  // { transition, allCriteria, canTransition, warnings }
  const [criteriaLoading, setCriteriaLoading] = useState(false)
  const [waiveTarget, setWaiveTarget] = useState(null)     // { id, name } — criterion being waived
  const [waiveReason, setWaiveReason] = useState('')

  // People / assignments
  const [showAddPerson, setShowAddPerson] = useState(false)
  const [personType, setPersonType] = useState('owns')
  const [personSearch, setPersonSearch] = useState('')
  const [users, setUsers] = useState([])

  // Search + link
  const [linkSearch, setLinkSearch] = useState('')
  const [linkResults, setLinkResults] = useState([])
  const [linkType, setLinkType] = useState('related')
  const [showLinkPanel, setShowLinkPanel] = useState(false)

  // Custom fields
  const [typeFields, setTypeFields] = useState([])
  const [fieldValues, setFieldValues] = useState({})

  // Acceptance criteria
  const [acItems, setAcItems] = useState([])
  const [newAcText, setNewAcText] = useState('')

  // Child creation
  const [childLibraryOpen, setChildLibraryOpen] = useState(false)
  const [childSelectedType, setChildSelectedType] = useState(null)
  const [childCreateOpen, setChildCreateOpen] = useState(false)
  const [libraryTypes, setLibraryTypes] = useState([])

  // Attachments
  const [attachments, setAttachments] = useState([])
  const [me, setMe] = useState(null)

  // Sync when parent changes the ID
  useEffect(() => {
    setActiveId(initialWorkItemId)
  }, [initialWorkItemId])

  const workItemId = activeId

  const loadAttachments = useCallback(async () => {
    if (!workItemId) return
    try {
      setAttachments(await listAttachments(workItemId))
    } catch { /* ignore */ }
  }, [workItemId])

  useEffect(() => { loadAttachments() }, [loadAttachments])

  useEffect(() => {
    auth.me().then(setMe).catch(() => setMe(null))
  }, [])

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
      setAcItems(wi.acceptance_criteria || [])
      setFieldValues(wi.field_values || {})
      // Load type field definitions
      if (wi.work_item_type_id) {
        try {
          const tf = await api.typeFields(wi.work_item_type_id)
          setTypeFields(tf.rows || [])
        } catch { setTypeFields([]) }
      }
    } catch (err) {
      console.error('Failed to load work item detail:', err)
    } finally {
      setLoading(false)
    }
  }, [workItemId])

  useEffect(() => {
    if (open && workItemId) loadData()
  }, [open, workItemId, loadData])

  // Mark all unread notifications for this work item as read when drawer opens
  useEffect(() => {
    if (open && workItemId) {
      notificationsApi.markReadBulk({ work_item_id: workItemId }).catch(() => {})
    }
  }, [open, workItemId])

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
    setTransitionOpen(false)
    setCriteriaLoading(true)
    try {
      const prep = await api.prepareTransition(workItemId, t.to_stage_id)
      const hasCriteria = prep.allCriteria && prep.allCriteria.length > 0
      const hasBlockingFailures = prep.blockedCriteria && prep.blockedCriteria.length > 0

      if (hasCriteria || hasBlockingFailures) {
        // Show criteria gate panel
        setCriteriaGate({
          transition: t,
          toStageId: t.to_stage_id,
          allCriteria: prep.allCriteria || [],
          blockedCriteria: prep.blockedCriteria || [],
          warnings: prep.warnings || [],
          canTransition: prep.canTransition,
          requiresReason: prep.requiresReason || t.requires_reason,
        })
        setCriteriaLoading(false)
        return
      }

      // No criteria — proceed directly (or prompt for reason)
      if (t.requires_reason || prep.requiresReason) {
        setCriteriaLoading(false)
        setReasonPrompt(t)
        setReasonText('')
        return
      }

      // Execute directly
      await api.transitionWorkItem(workItemId, t.to_stage_id)
      await loadData()
      onChanged?.()
    } catch (err) {
      console.error('Transition prepare failed:', err)
    } finally { setCriteriaLoading(false) }
  }

  async function handleAcknowledge(criterionId) {
    if (!criteriaGate) return
    try {
      await api.acknowledgeCriterion(workItemId, criterionId)
      // Re-prepare to get updated state
      const prep = await api.prepareTransition(workItemId, criteriaGate.toStageId)
      setCriteriaGate(prev => ({
        ...prev,
        allCriteria: prep.allCriteria || [],
        blockedCriteria: prep.blockedCriteria || [],
        warnings: prep.warnings || [],
        canTransition: prep.canTransition,
      }))
    } catch (err) { console.error('Acknowledge failed:', err) }
  }

  async function handleUnacknowledge(criterionId) {
    if (!criteriaGate) return
    try {
      await api.unacknowledgeCriterion(workItemId, criterionId)
      const prep = await api.prepareTransition(workItemId, criteriaGate.toStageId)
      setCriteriaGate(prev => ({
        ...prev,
        allCriteria: prep.allCriteria || [],
        blockedCriteria: prep.blockedCriteria || [],
        warnings: prep.warnings || [],
        canTransition: prep.canTransition,
      }))
    } catch (err) { console.error('Unacknowledge failed:', err) }
  }

  async function handleWaive() {
    if (!waiveTarget || !waiveReason.trim()) return
    try {
      await api.waiveCriterion(workItemId, waiveTarget.id, waiveReason.trim())
      setWaiveTarget(null)
      setWaiveReason('')
      // Re-prepare
      const prep = await api.prepareTransition(workItemId, criteriaGate.toStageId)
      setCriteriaGate(prev => ({
        ...prev,
        allCriteria: prep.allCriteria || [],
        blockedCriteria: prep.blockedCriteria || [],
        warnings: prep.warnings || [],
        canTransition: prep.canTransition,
      }))
    } catch (err) { console.error('Waive failed:', err) }
  }

  async function confirmTransitionFromGate() {
    if (!criteriaGate) return
    const { toStageId, requiresReason } = criteriaGate
    if (requiresReason) {
      setReasonPrompt({ ...criteriaGate.transition, to_stage_id: toStageId })
      setReasonText('')
      setCriteriaGate(null)
      return
    }
    setSaving(true)
    try {
      await api.transitionWorkItem(workItemId, toStageId)
      setCriteriaGate(null)
      await loadData()
      onChanged?.()
    } finally { setSaving(false) }
  }

  async function confirmTransitionWithReason() {
    if (!reasonPrompt) return
    setSaving(true)
    try {
      await api.transitionWorkItem(workItemId, reasonPrompt.to_stage_id, reasonText)
      setReasonPrompt(null)
      setCriteriaGate(null)
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

  // Acceptance criteria
  // TODO: addAcItem and removeAcItem require 'manage_acceptance_criteria' permission (org-level)
  // toggleAcItem (check/uncheck) is unrestricted. Hide add/remove UI when user lacks permission.
  async function saveAcItems(items) {
    setAcItems(items)
    try {
      await api.updateAcceptanceCriteria(workItemId, items)
    } catch (err) { console.error('Failed to save acceptance criteria:', err) }
  }

  function toggleAcItem(id) {
    saveAcItems(acItems.map(i => i.id === id ? { ...i, checked: !i.checked } : i))
  }

  function removeAcItem(id) {
    saveAcItems(acItems.filter(i => i.id !== id))
  }

  function addAcItem() {
    if (!newAcText.trim()) return
    const nextId = acItems.length > 0 ? Math.max(...acItems.map(i => i.id)) + 1 : 1
    saveAcItems([...acItems, { id: nextId, text: newAcText.trim(), checked: false }])
    setNewAcText('')
  }

  // Custom field save
  async function saveFieldValues(next) {
    setFieldValues(next)
    try {
      await api.updateWorkItem(workItemId, { field_values: next })
      onChanged?.()
    } catch (err) { console.error('Failed to save field values:', err) }
  }

  // People management
  async function openAddPerson() {
    try {
      const res = await api.users()
      setUsers(res.rows || [])
    } catch { /* ignore */ }
    setShowAddPerson(true)
  }

  async function addPerson(userId) {
    setSaving(true)
    try {
      await api.addRelationship(workItemId, userId, personType)
      setShowAddPerson(false)
      const rels = await api.workItemRelationships(workItemId)
      setRelationships(rels.rows || [])
      onChanged?.()
    } catch (err) {
      console.error('Failed to add person:', err)
    } finally { setSaving(false) }
  }

  async function removePerson(relId) {
    setSaving(true)
    try {
      await api.removeRelationship(relId)
      const rels = await api.workItemRelationships(workItemId)
      setRelationships(rels.rows || [])
      onChanged?.()
    } finally { setSaving(false) }
  }

  // Load service library for child creation
  async function openChildLibrary() {
    try {
      const res = await api.serviceLibrary(item.owner_org_id || 0)
      setLibraryTypes(res.rows || [])
      setChildLibraryOpen(true)
    } catch { setChildLibraryOpen(true) }
  }

  const childCreateFields = [
    { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'What needs to happen?' },
    { key: 'description', label: 'Description', type: 'textarea', placeholder: 'Optional context...' },
  ]

  async function handleCreateChild(values) {
    const result = await api.createWorkItem({
      title: values.title,
      description: values.description || undefined,
      work_item_type_id: childSelectedType?.id,
      owner_org_id: childSelectedType?.owner_org_id || item.owner_org_id,
    })
    // Link as child
    if (result?.id) {
      await api.addWorkItemLink(workItemId, result.id, 'child')
    }
    return result
  }

  async function onChildCreated() {
    setChildCreateOpen(false)
    // Reload links
    const lnks = await api.workItemLinks(workItemId)
    setLinks(lnks.rows || [])
    onChanged?.()
  }

  if (!item && !loading) return null

  const cos = SERVICE_CLASS_CONFIG[item?.derived_service_class] || SERVICE_CLASS_CONFIG.standard

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent overlay={false}>
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
              {['details', 'activity', 'comments'].map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-2 text-xs transition-colors border-b-2 -mb-px ${
                    tab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t === 'details'
                    ? 'Details'
                    : t === 'activity'
                      ? 'Activity'
                      : `Comments (${comments.length})`}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-4">
              {tab === 'activity' ? (
                <WorkItemHistory workItemId={workItemId} />
              ) : tab === 'details' ? (
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

                  {/* Custom Fields */}
                  <CustomFields
                    fields={typeFields}
                    values={fieldValues}
                    onSave={saveFieldValues}
                  />

                  {/* Acceptance Criteria */}
                  <div className="flex flex-col gap-2 pt-3 mt-1 border-t border-border">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Acceptance Criteria
                        {acItems.length > 0 && (
                          <span className="ml-1 normal-case">
                            ({acItems.filter(i => i.checked).length}/{acItems.length})
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {acItems.map(ac => (
                        <div key={ac.id} className="flex items-start gap-1.5 group">
                          <input
                            type="checkbox"
                            checked={!!ac.checked}
                            onChange={() => toggleAcItem(ac.id)}
                            className="mt-0.5 accent-primary flex-shrink-0"
                          />
                          <span className={[
                            'text-xs flex-1',
                            ac.checked && 'line-through text-muted-foreground',
                          ].filter(Boolean).join(' ')}>
                            {ac.text}
                          </span>
                          <button
                            onClick={() => removeAcItem(ac.id)}
                            className="text-muted-foreground/30 hover:text-destructive transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                            title="Remove"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        value={newAcText}
                        onChange={e => setNewAcText(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addAcItem()}
                        placeholder="Add criterion..."
                        className="flex-1 text-xs bg-background border border-border rounded px-2 py-1 focus:outline-none focus:border-primary"
                      />
                      <Button size="sm" variant="ghost" onClick={addAcItem} disabled={!newAcText.trim()}>
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
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

                    {/* Exit criteria gate */}
                    {criteriaLoading && (
                      <div className="flex items-center gap-2 p-3 border border-border rounded bg-background">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Evaluating exit criteria...</span>
                      </div>
                    )}

                    {criteriaGate && (
                      <div className="flex flex-col gap-2 p-3 border border-border rounded bg-background">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-foreground">
                            Exit criteria for transition to "{criteriaGate.transition.transition_label || criteriaGate.transition.to_stage_name}"
                          </span>
                          <button
                            onClick={() => { setCriteriaGate(null); setWaiveTarget(null); setWaiveReason('') }}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <div className="flex flex-col gap-1.5">
                          {criteriaGate.allCriteria.map(c => {
                            const isMet = c.passed
                            const isManual = c.tier === 'manual'
                            const isBlocking = c.is_blocking

                            return (
                              <div
                                key={c.id}
                                className={[
                                  'flex items-start gap-2 px-2 py-1.5 rounded text-xs',
                                  isMet ? 'bg-[#2D6A3C]/5' : (isBlocking ? 'bg-[#A33A25]/5' : 'bg-[#AD7B1A]/5'),
                                ].join(' ')}
                              >
                                {/* Status icon */}
                                {isMet ? (
                                  <Check className="h-3.5 w-3.5 text-[#2D6A3C] mt-0.5 flex-shrink-0" />
                                ) : isManual ? (
                                  <CircleDot className="h-3.5 w-3.5 text-[#AD7B1A] mt-0.5 flex-shrink-0" />
                                ) : (
                                  <AlertTriangle className="h-3.5 w-3.5 text-[#A33A25] mt-0.5 flex-shrink-0" />
                                )}

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className={isMet ? 'text-muted-foreground' : 'text-foreground'}>{c.name}</span>
                                    <span className="text-muted-foreground/50">
                                      {c.tier === 'manual' ? '(manual)' : c.tier === 'codified' ? '(auto)' : '(api)'}
                                    </span>
                                    {!isBlocking && <span className="text-muted-foreground/50 italic">advisory</span>}
                                  </div>
                                  {!isMet && c.reason && (
                                    <div className="text-muted-foreground mt-0.5">{c.reason}</div>
                                  )}
                                  {c.description && isMet && (
                                    <div className="text-muted-foreground/60 mt-0.5">{c.description}</div>
                                  )}
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  {isManual && !isMet && (
                                    <button
                                      onClick={() => handleAcknowledge(c.id)}
                                      className="px-2 py-0.5 text-xs rounded bg-primary/10 text-primary hover:bg-primary/20"
                                    >
                                      Confirm
                                    </button>
                                  )}
                                  {isManual && isMet && (
                                    <button
                                      onClick={() => handleUnacknowledge(c.id)}
                                      className="px-2 py-0.5 text-xs rounded text-muted-foreground hover:text-foreground hover:bg-black/[0.03]"
                                    >
                                      Undo
                                    </button>
                                  )}
                                  {!isMet && isBlocking && c.tier !== 'manual' && (
                                    <button
                                      onClick={() => { setWaiveTarget({ id: c.id, name: c.name }); setWaiveReason('') }}
                                      className="px-2 py-0.5 text-xs rounded text-muted-foreground hover:text-[#AD7B1A] hover:bg-[#AD7B1A]/5"
                                      title="Waive this criterion"
                                    >
                                      <Shield className="h-3 w-3" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>

                        {/* Waive reason input */}
                        {waiveTarget && (
                          <div className="flex flex-col gap-1.5 p-2 bg-[#AD7B1A]/5 rounded">
                            <span className="text-xs text-muted-foreground">
                              Waive "{waiveTarget.name}" — reason required:
                            </span>
                            <input
                              value={waiveReason}
                              onChange={e => setWaiveReason(e.target.value)}
                              className="text-xs bg-card border border-border rounded px-2 py-1.5 focus:outline-none focus:border-primary"
                              placeholder="Why is this criterion being waived?"
                              autoFocus
                            />
                            <div className="flex gap-2">
                              <Button size="sm" onClick={handleWaive} disabled={!waiveReason.trim()}>
                                Waive
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => setWaiveTarget(null)}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* Warnings */}
                        {criteriaGate.warnings.length > 0 && (
                          <div className="text-xs text-[#AD7B1A] flex items-center gap-1.5">
                            <AlertTriangle className="h-3 w-3" />
                            {criteriaGate.warnings.length} advisory warning{criteriaGate.warnings.length !== 1 ? 's' : ''} (non-blocking)
                          </div>
                        )}

                        {/* Confirm/blocked actions */}
                        <div className="flex items-center gap-2 pt-1">
                          {criteriaGate.canTransition ? (
                            <Button size="sm" onClick={confirmTransitionFromGate} disabled={saving}>
                              {saving ? 'Transitioning...' : 'Confirm Transition'}
                            </Button>
                          ) : (
                            <Button size="sm" disabled className="opacity-50">
                              Blocked — criteria not met
                            </Button>
                          )}
                          <Button variant="outline" size="sm" onClick={() => { setCriteriaGate(null); setWaiveTarget(null) }}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Reason prompt */}
                    {reasonPrompt && !criteriaGate && (
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

                  {/* Children */}
                  <div className="flex flex-col gap-2 pt-3 mt-1 border-t border-border">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Children</span>
                      <button
                        onClick={openChildLibrary}
                        className="text-xs text-primary hover:text-primary/80 transition-colors"
                        title="Add child work item"
                      >
                        + Add
                      </button>
                    </div>
                    {links.filter(l => l.link_type === 'child').length === 0 ? (
                      <span className="text-xs text-muted-foreground/60">No children yet</span>
                    ) : (
                      links.filter(l => l.link_type === 'child').map((l, i) => (
                        <button
                          key={i}
                          className="flex items-center gap-2 text-xs w-full text-left hover:bg-black/[0.03] rounded px-1 py-1 -mx-1 transition-colors"
                          onClick={() => { setActiveId(l.id); setTab('details') }}
                        >
                          <span className="text-xs text-muted-foreground">{l.display_key}</span>
                          <span className="truncate">{l.title}</span>
                          <span className="ml-auto text-xs text-muted-foreground">{l.current_stage_name}</span>
                        </button>
                      ))
                    )}
                  </div>

                  {/* Linked items (non-child) */}
                  {links.filter(l => l.link_type !== 'child').length > 0 && (
                    <div className="flex flex-col gap-2 pt-3 mt-1 border-t border-border">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Linked Items</span>
                      {links.filter(l => l.link_type !== 'child').map((l, i) => (
                        <button
                          key={i}
                          className="flex items-center gap-2 text-xs w-full text-left hover:bg-black/[0.03] rounded px-1 py-1 -mx-1 transition-colors"
                          onClick={() => { setActiveId(l.id); setTab('details') }}
                        >
                          <Badge variant="muted">{l.link_type}</Badge>
                          <span className="text-xs text-muted-foreground">{l.display_key}</span>
                          <span className="truncate">{l.title}</span>
                          <span className="ml-auto text-xs text-muted-foreground">{l.current_stage_name}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* People / Assignments */}
                  <div className="flex flex-col gap-2 pt-3 mt-1 border-t border-border">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">People</span>
                      <button
                        onClick={openAddPerson}
                        className="text-xs text-primary hover:text-primary/80 transition-colors"
                        title="Add person"
                      >
                        + Add
                      </button>
                    </div>

                    {relationships.length === 0 && !showAddPerson && (
                      <span className="text-xs text-muted-foreground/60">No people assigned</span>
                    )}

                    {relationships.map(r => (
                      <div key={r.id} className="flex items-center gap-2 text-xs group">
                        <span
                          className="w-6 h-6 rounded-full bg-muted text-xs flex items-center justify-center flex-shrink-0 text-muted-foreground"
                          title={r.display_name}
                        >
                          {r.display_name?.split(/\s+/).map(p => p[0]).join('').toUpperCase().slice(0, 2)}
                        </span>
                        <span className="flex-1">{r.display_name}</span>
                        <Badge variant="muted">{r.relationship_type.replace(/_/g, ' ')}</Badge>
                        <button
                          onClick={() => removePerson(r.id)}
                          className="text-muted-foreground/40 hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                          title="Remove"
                          disabled={saving}
                        >
                          ✕
                        </button>
                      </div>
                    ))}

                    {/* Add person panel */}
                    {showAddPerson && (
                      <div className="flex flex-col gap-2 p-3 border border-border rounded bg-background">
                        <div className="flex items-center gap-2">
                          <select
                            value={personType}
                            onChange={e => setPersonType(e.target.value)}
                            className="text-xs bg-card border border-border rounded px-2 py-1.5"
                          >
                            <option value="owns">Owner</option>
                            <option value="working_on">Working on</option>
                            <option value="reviewing">Reviewer</option>
                            <option value="watching">Watching</option>
                          </select>
                          <button
                            onClick={() => { setShowAddPerson(false); setPersonSearch('') }}
                            className="ml-auto text-xs text-muted-foreground hover:text-foreground"
                          >
                            cancel
                          </button>
                        </div>
                        <input
                          value={personSearch}
                          onChange={e => setPersonSearch(e.target.value)}
                          placeholder="Search by name..."
                          className="w-full text-xs bg-card border border-border rounded px-2 py-1.5 focus:outline-none focus:border-primary placeholder:text-muted-foreground/40"
                          autoFocus
                        />
                        <div className="max-h-40 overflow-y-auto border border-border rounded">
                          {users
                            .filter(u => !relationships.some(r => r.user_id === u.id && r.relationship_type === personType))
                            .filter(u => !personSearch || u.display_name?.toLowerCase().includes(personSearch.toLowerCase()))
                            .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''))
                            .map(u => (
                              <button
                                key={u.id}
                                onClick={() => { addPerson(u.id); setPersonSearch('') }}
                                className="w-full text-left px-3 py-2 text-xs hover:bg-black/[0.03] transition-colors flex items-center gap-2 border-b border-border/30 last:border-0"
                                disabled={saving}
                              >
                                <span className="w-5 h-5 rounded-full bg-muted text-xs flex items-center justify-center flex-shrink-0 text-muted-foreground">
                                  {u.display_name?.split(/\s+/).map(p => p[0]).join('').toUpperCase().slice(0, 2)}
                                </span>
                                <span>{u.display_name}</span>
                              </button>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Attachments */}
                  <section className="flex flex-col gap-2 pt-3 mt-1 border-t border-border">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Attachments
                    </div>
                    <AttachmentUpload workItemId={workItemId} onUploaded={loadAttachments} />
                    <AttachmentsList
                      workItemId={workItemId}
                      attachments={attachments}
                      currentUserId={me?.id}
                      isAdmin={me?.is_admin === true}
                      onChanged={loadAttachments}
                    />
                  </section>

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

      {/* Child creation: Service Library */}
      <ServiceLibrary
        open={childLibraryOpen}
        onOpenChange={setChildLibraryOpen}
        types={libraryTypes}
        onSelect={type => { setChildSelectedType(type); setChildCreateOpen(true); setChildLibraryOpen(false) }}
      />

      {/* Child creation: Form */}
      <FormDrawer
        open={childCreateOpen}
        onOpenChange={setChildCreateOpen}
        title={childSelectedType ? `New ${childSelectedType.name}` : 'New Child Item'}
        fields={childCreateFields}
        onSubmit={handleCreateChild}
        onSaved={onChildCreated}
      />
    </Sheet>
  )
}
