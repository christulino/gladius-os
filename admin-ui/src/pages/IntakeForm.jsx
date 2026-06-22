/**
 * IntakeForm.jsx
 * Public-facing intake form — no authentication required.
 *
 * Renders dynamically from field definitions attached to a
 * service catalog item. Accessible at /forms/:slug.
 */

import { useState, useEffect, useMemo } from 'react'
import { forms } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  CheckCircle2, AlertCircle, Loader2, ArrowLeft, Send,
} from 'lucide-react'

// ─── Field Renderer ──────────────────────────────────────────────────────────

function FormField({ field, value, onChange, error }) {
  const id = `field-${field.field_key}`
  const constraints = field.constraints || {}

  const label = (
    <label htmlFor={id} className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
      {field.field_label}
      {field.is_required && <span className="text-destructive ml-0.5">*</span>}
    </label>
  )

  const inputClass = `w-full bg-card border rounded px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors ${
    error ? 'border-destructive' : 'border-border'
  }`

  switch (field.field_type) {
    case 'text':
      return (
        <div>
          {label}
          <input
            id={id}
            type="text"
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            maxLength={constraints.max_length || undefined}
            className={inputClass}
            placeholder={field.field_label}
          />
          {error && <p className="text-xs text-destructive mt-0.5">{error}</p>}
        </div>
      )

    case 'textarea':
      return (
        <div>
          {label}
          <textarea
            id={id}
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            maxLength={constraints.max_length || undefined}
            rows={4}
            className={inputClass + ' resize-y min-h-[80px]'}
            placeholder={field.field_label}
          />
          {error && <p className="text-xs text-destructive mt-0.5">{error}</p>}
        </div>
      )

    case 'number':
      return (
        <div>
          {label}
          <input
            id={id}
            type="number"
            value={value ?? ''}
            onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
            min={constraints.min ?? undefined}
            max={constraints.max ?? undefined}
            className={inputClass}
            placeholder={field.field_label}
          />
          {error && <p className="text-xs text-destructive mt-0.5">{error}</p>}
        </div>
      )

    case 'boolean':
      return (
        <div className="flex items-center gap-2 py-1">
          <input
            id={id}
            type="checkbox"
            checked={!!value}
            onChange={e => onChange(e.target.checked)}
            className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30"
          />
          <label htmlFor={id} className="text-xs text-foreground cursor-pointer">
            {field.field_label}
            {field.is_required && <span className="text-destructive ml-0.5">*</span>}
          </label>
          {error && <p className="text-xs text-destructive ml-2">{error}</p>}
        </div>
      )

    case 'date':
      return (
        <div>
          {label}
          <input
            id={id}
            type="date"
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            className={inputClass}
          />
          {error && <p className="text-xs text-destructive mt-0.5">{error}</p>}
        </div>
      )

    case 'url':
      return (
        <div>
          {label}
          <input
            id={id}
            type="url"
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            className={inputClass}
            placeholder="https://..."
          />
          {error && <p className="text-xs text-destructive mt-0.5">{error}</p>}
        </div>
      )

    case 'select':
      const selectOptions = field.lookup_values?.length
        ? field.lookup_values
        : (field.field_options || []).map(o => typeof o === 'string' ? { label: o, id: o } : o)
      return (
        <div>
          {label}
          <select
            id={id}
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            className={inputClass}
          >
            <option value="">Select...</option>
            {selectOptions.map(opt => (
              <option key={opt.id || opt.label} value={opt.label}>{opt.label}</option>
            ))}
          </select>
          {error && <p className="text-xs text-destructive mt-0.5">{error}</p>}
        </div>
      )

    case 'multi_select':
      const msOptions = field.lookup_values?.length
        ? field.lookup_values
        : (field.field_options || []).map(o => typeof o === 'string' ? { label: o, id: o } : o)
      const selected = Array.isArray(value) ? value : []
      return (
        <div>
          {label}
          <div className="flex flex-wrap gap-1.5 mt-1">
            {msOptions.map(opt => {
              const isChecked = selected.includes(opt.label)
              return (
                <button
                  key={opt.id || opt.label}
                  type="button"
                  onClick={() => {
                    onChange(isChecked
                      ? selected.filter(v => v !== opt.label)
                      : [...selected, opt.label])
                  }}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${
                    isChecked
                      ? 'bg-primary/10 border-primary/30 text-primary font-medium'
                      : 'bg-card border-border text-muted-foreground hover:border-primary/30'
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
          {error && <p className="text-xs text-destructive mt-0.5">{error}</p>}
        </div>
      )

    default:
      return (
        <div>
          {label}
          <input
            id={id}
            type="text"
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            className={inputClass}
            placeholder={field.field_label}
          />
          {error && <p className="text-xs text-destructive mt-0.5">{error}</p>}
        </div>
      )
  }
}

// ─── Main Form Component ─────────────────────────────────────────────────────

export default function IntakeForm({ slug }) {
  const [formConfig, setFormConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // Form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [requesterName, setRequesterName] = useState('')
  const [requesterEmail, setRequesterEmail] = useState('')
  const [fieldValues, setFieldValues] = useState({})
  const [dueDate, setDueDate] = useState('')
  const [isExpedited, setIsExpedited] = useState(false)

  // Submission state
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(null) // { display_key, message }

  useEffect(() => {
    forms.getForm(slug)
      .then(data => {
        setFormConfig(data)
        // Set defaults
        const defaults = {}
        for (const f of data.fields) {
          if (f.default_value != null) {
            defaults[f.field_key] = typeof f.default_value === 'object' && f.default_value.value !== undefined
              ? f.default_value.value
              : f.default_value
          }
        }
        setFieldValues(defaults)
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [slug])

  // Group fields by field_group
  const fieldGroups = useMemo(() => {
    if (!formConfig?.fields) return []
    const groups = new Map()
    for (const f of formConfig.fields) {
      const group = f.field_group || 'Details'
      if (!groups.has(group)) groups.set(group, [])
      groups.get(group).push(f)
    }
    return [...groups.entries()]
  }, [formConfig])

  function validate() {
    const errs = {}
    if (!title.trim()) errs._title = 'Title is required'
    if (!requesterEmail.trim()) errs._email = 'Email is required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requesterEmail.trim())) errs._email = 'Invalid email'

    for (const f of formConfig?.fields || []) {
      if (f.is_required) {
        const val = fieldValues[f.field_key]
        if (val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0)) {
          errs[f.field_key] = `${f.field_label} is required`
        }
      }
      // Number constraints
      if (f.field_type === 'number' && f.constraints) {
        const val = fieldValues[f.field_key]
        if (val != null) {
          if (f.constraints.min != null && val < f.constraints.min) errs[f.field_key] = `Minimum: ${f.constraints.min}`
          if (f.constraints.max != null && val > f.constraints.max) errs[f.field_key] = `Maximum: ${f.constraints.max}`
        }
      }
    }
    return errs
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validate()
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    setSubmitting(true)
    try {
      const result = await forms.submit(slug, {
        title: title.trim(),
        description: description.trim() || undefined,
        field_values: fieldValues,
        requester_name: requesterName.trim() || undefined,
        requester_email: requesterEmail.trim(),
        due_date: dueDate || undefined,
        is_expedited: isExpedited,
      })
      setSubmitted({
        display_key: result.work_item?.display_key,
        message: result.message,
      })
    } catch (err) {
      setErrors({ _submit: err.message })
    } finally {
      setSubmitting(false)
    }
  }

  function handleFieldChange(key, val) {
    setFieldValues(prev => ({ ...prev, [key]: val }))
    // Clear error on change
    if (errors[key]) {
      setErrors(prev => { const next = { ...prev }; delete next[key]; return next })
    }
  }

  // ─── Loading / Not Found ───────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-primary animate-spin" />
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-semibold text-foreground">Form Not Found</p>
          <p className="text-xs text-muted-foreground mt-1">This intake form doesn't exist or is no longer active.</p>
        </div>
      </div>
    )
  }

  // ─── Success ───────────────────────────────────────────────────────────────

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="bg-card border border-border rounded-lg p-8 max-w-md w-full text-center">
          <CheckCircle2 className="w-10 h-10 text-primary mx-auto mb-4" />
          <p className="text-sm font-semibold text-foreground mb-2">Request Submitted</p>
          <p className="text-xs text-muted-foreground mb-4">{submitted.message}</p>
          {submitted.display_key && (
            <div className="bg-background border border-border rounded px-4 py-3 mb-4">
              <p className="text-xs text-muted-foreground">Your tracking number</p>
              <p className="text-sm font-semibold text-foreground mt-0.5">{submitted.display_key}</p>
            </div>
          )}
          <button
            onClick={() => {
              setSubmitted(null)
              setTitle('')
              setDescription('')
              setFieldValues({})
              setDueDate('')
              setIsExpedited(false)
              setErrors({})
            }}
            className="text-xs text-primary hover:underline"
          >
            Submit another request
          </button>
        </div>
      </div>
    )
  }

  // ─── Form ──────────────────────────────────────────────────────────────────

  const { form, fields } = formConfig

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{form.org_name}</p>
          <h1 className="text-sm font-semibold text-foreground">{form.title}</h1>
          {form.description && (
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{form.description}</p>
          )}
          {form.requires_approval && (
            <p className="text-xs text-muted-foreground/60 mt-2 italic">
              Submissions will be reviewed before processing.
            </p>
          )}
        </div>
      </div>

      {/* Form body */}
      <div className="max-w-2xl mx-auto px-4 py-6">
        <form onSubmit={handleSubmit} className="space-y-6">

          {/* About You */}
          <div className="bg-card border border-border rounded-lg p-5">
            <p className="text-sm font-semibold text-foreground mb-4">About You</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="requester-name" className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  Your Name
                </label>
                <input
                  id="requester-name"
                  type="text"
                  value={requesterName}
                  onChange={e => setRequesterName(e.target.value)}
                  className="w-full bg-card border border-border rounded px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                  placeholder="Your name"
                />
              </div>
              <div>
                <label htmlFor="requester-email" className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  Email <span className="text-destructive">*</span>
                </label>
                <input
                  id="requester-email"
                  type="email"
                  value={requesterEmail}
                  onChange={e => { setRequesterEmail(e.target.value); if (errors._email) setErrors(prev => { const n = { ...prev }; delete n._email; return n }) }}
                  className={`w-full bg-card border rounded px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors ${
                    errors._email ? 'border-destructive' : 'border-border'
                  }`}
                  placeholder="you@example.com"
                />
                {errors._email && <p className="text-xs text-destructive mt-0.5">{errors._email}</p>}
              </div>
            </div>
          </div>

          {/* Request details */}
          <div className="bg-card border border-border rounded-lg p-5">
            <p className="text-sm font-semibold text-foreground mb-4">Request</p>
            <div className="space-y-4">
              <div>
                <label htmlFor="title" className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  Title <span className="text-destructive">*</span>
                </label>
                <input
                  id="title"
                  type="text"
                  value={title}
                  onChange={e => { setTitle(e.target.value); if (errors._title) setErrors(prev => { const n = { ...prev }; delete n._title; return n }) }}
                  className={`w-full bg-card border rounded px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors ${
                    errors._title ? 'border-destructive' : 'border-border'
                  }`}
                  placeholder="Brief summary of your request"
                />
                {errors._title && <p className="text-xs text-destructive mt-0.5">{errors._title}</p>}
              </div>

              <div>
                <label htmlFor="description" className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  Description
                </label>
                <textarea
                  id="description"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={4}
                  className="w-full bg-card border border-border rounded px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors resize-y min-h-[80px]"
                  placeholder="Provide any relevant details, context, or requirements..."
                />
              </div>
            </div>
          </div>

          {/* Dynamic fields grouped by field_group */}
          {fieldGroups.length > 0 && fieldGroups.map(([groupName, groupFields]) => (
            <div key={groupName} className="bg-card border border-border rounded-lg p-5">
              <p className="text-sm font-semibold text-foreground mb-4">{groupName}</p>
              <div className="space-y-4">
                {groupFields.map(f => (
                  <FormField
                    key={f.id}
                    field={f}
                    value={fieldValues[f.field_key]}
                    onChange={val => handleFieldChange(f.field_key, val)}
                    error={errors[f.field_key]}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* Scheduling (optional) */}
          <div className="bg-card border border-border rounded-lg p-5">
            <p className="text-sm font-semibold text-foreground mb-4">Scheduling</p>
            <div className="space-y-4">
              <div>
                <label htmlFor="due-date" className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  Due Date
                </label>
                <input
                  id="due-date"
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  className="w-full bg-card border border-border rounded px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                />
                <p className="text-xs text-muted-foreground/60 mt-0.5">Leave blank if there's no hard deadline.</p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="is-expedited"
                  type="checkbox"
                  checked={isExpedited}
                  onChange={e => setIsExpedited(e.target.checked)}
                  className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30"
                />
                <label htmlFor="is-expedited" className="text-xs text-foreground cursor-pointer">
                  This is urgent and needs immediate attention
                </label>
              </div>
            </div>
          </div>

          {/* Submit */}
          {errors._submit && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg px-4 py-3">
              <p className="text-xs text-destructive flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {errors._submit}
              </p>
            </div>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={submitting} className="gap-1.5">
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  Submit Request
                </>
              )}
            </Button>
          </div>
        </form>
      </div>

      {/* Footer */}
      <div className="border-t border-border bg-card mt-8">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <p className="text-xs text-muted-foreground/50 text-center">
            Powered by Gladius OS
          </p>
        </div>
      </div>
    </div>
  )
}
