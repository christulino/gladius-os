/**
 * FormDrawer — reusable create form in a right-side sheet.
 *
 * Field config:
 *   { key, label, type, required, placeholder, hint, defaultValue }
 *   type: 'text' | 'textarea' | 'select' | 'boolean'
 *
 * Select fields:
 *   { options: [{label, value}] }        — static list
 *   { loadOptions: async (values) => [{label, value}] } — async, receives current form values
 *   { dependsOn: 'fieldKey' }            — re-load options when that field changes
 *
 * Slug fields:
 *   { isSlug: true, slugFrom: 'name' }   — auto-populate from another field (user can override)
 */

import { useState, useEffect, useRef } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet'
import { Button }  from '@/components/ui/button'
import { Switch }  from '@/components/ui/switch'
import { api }     from '@/lib/api'
import { ColorPicker } from '@/components/ColorPicker'

function ImageField({ value, onChange, onError }) {
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef(null)

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      setUploading(true)
      try {
        const result = await api.uploadAvatar(ev.target.result, file.name)
        onChange(result.url)
      } catch (err) {
        onError?.(err.message)
      } finally {
        setUploading(false)
      }
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="flex items-center gap-4">
      {/* Avatar preview */}
      <div
        className="w-14 h-14 rounded-full border-2 border-border flex-shrink-0 overflow-hidden bg-muted flex items-center justify-center"
      >
        {value ? (
          <img src={value} alt="Avatar" className="w-full h-full object-cover" />
        ) : (
          <span className="text-muted-foreground text-xl">👤</span>
        )}
      </div>

      <div className="flex flex-col gap-1.5 flex-1 min-w-0">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="font-mono text-xs w-fit"
        >
          {uploading ? 'Uploading...' : value ? 'Change photo' : 'Choose photo'}
        </Button>
        {value && (
          <span className="font-mono text-[10px] text-muted-foreground/60 truncate">{value}</span>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          className="hidden"
          onChange={handleFile}
        />
      </div>
    </div>
  )
}

function toSlug(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export function FormDrawer({ open, onOpenChange, title, fields = [], initialValues, onSubmit, onSaved, extraContent }) {
  const isEdit = !!initialValues
  const [values,       setValues]       = useState({})
  const [options,      setOptions]      = useState({}) // fieldKey → [{label, value}]
  const [slugTouched,  setSlugTouched]  = useState({}) // fieldKey → bool
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState(null)
  const prevDeps = useRef({})

  // Reset form and load initial options on open
  useEffect(() => {
    if (!open) return
    const initial = {}
    const touched = {}
    for (const f of fields) {
      // Edit mode: seed from initialValues; create mode: use defaultValue
      if (isEdit) {
        const raw = initialValues[f.key]
        initial[f.key] = raw !== undefined && raw !== null
          ? (f.type === 'boolean' ? Boolean(raw) : String(raw))
          : (f.type === 'boolean' ? false : '')
      } else {
        initial[f.key] = f.defaultValue ?? (f.type === 'boolean' ? false : '')
      }
      // In edit mode slug is already set — mark as touched so it won't auto-regenerate
      if (f.isSlug) touched[f.key] = isEdit
    }
    setValues(initial)
    setSlugTouched(touched)
    setError(null)
    prevDeps.current = {}

    // Load static or no-dependency async selects
    for (const f of fields) {
      if (f.type !== 'select') continue
      if (f.options) {
        setOptions(o => ({ ...o, [f.key]: f.options }))
      } else if (f.loadOptions && !f.dependsOn) {
        f.loadOptions(initial).then(opts =>
          setOptions(o => ({ ...o, [f.key]: opts }))
        ).catch(() => {})
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Re-load dependent select options when their source field changes
  useEffect(() => {
    for (const f of fields) {
      if (f.type !== 'select' || !f.dependsOn || !f.loadOptions) continue
      const depVal = values[f.dependsOn]
      if (prevDeps.current[f.key] === depVal) continue
      prevDeps.current = { ...prevDeps.current, [f.key]: depVal }
      // Clear the dependent field value and reload options
      setValues(v => ({ ...v, [f.key]: '' }))
      if (depVal) {
        f.loadOptions(values).then(opts =>
          setOptions(o => ({ ...o, [f.key]: opts }))
        ).catch(() => setOptions(o => ({ ...o, [f.key]: [] })))
      } else {
        setOptions(o => ({ ...o, [f.key]: [] }))
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, values])

  function set(key, val) {
    setValues(v => {
      const next = { ...v, [key]: val }
      // Auto-populate slug fields from their source if not manually touched
      for (const f of fields) {
        if (f.isSlug && f.slugFrom === key && !slugTouched[f.key]) {
          next[f.key] = toSlug(String(val))
        }
      }
      return next
    })
    setError(null)
  }

  function setSlug(key, val) {
    setSlugTouched(t => ({ ...t, [key]: !!val }))
    setValues(v => ({ ...v, [key]: val }))
    setError(null)
  }

  async function handleSubmit() {
    for (const f of fields) {
      if (f.required && !values[f.key] && values[f.key] !== false) {
        setError(`${f.label} is required`)
        return
      }
    }
    setSaving(true)
    setError(null)
    try {
      await onSubmit(values)
      onOpenChange(false)
      onSaved?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent onInteractOutside={e => e.preventDefault()}>
        <SheetHeader>
          <SheetTitle className="font-mono text-sm">{title}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {fields.map(f => (
            <div key={f.key} className="flex flex-col gap-1.5">
              <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                {f.label}
                {f.required && <span className="text-destructive/70">*</span>}
              </label>

              {f.hint && (
                <p className="font-mono text-[10px] text-muted-foreground/60 leading-relaxed">{f.hint}</p>
              )}

              {f.type === 'color' ? (
                <ColorPicker
                  value={values[f.key] ?? ''}
                  onChange={v => set(f.key, v)}
                />
              ) : f.type === 'image' ? (
                <ImageField
                  value={values[f.key] ?? ''}
                  onChange={url => { set(f.key, url); setError(null) }}
                  onError={setError}
                />
              ) : f.type === 'boolean' ? (
                <div className="flex items-center gap-3">
                  <Switch checked={!!values[f.key]} onCheckedChange={v => set(f.key, v)} />
                  <span className="font-mono text-xs text-muted-foreground">
                    {values[f.key] ? 'Yes' : 'No'}
                  </span>
                </div>
              ) : f.type === 'textarea' ? (
                <textarea
                  value={values[f.key] ?? ''}
                  onChange={e => set(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  rows={3}
                  className="w-full bg-background border border-border rounded text-xs font-mono text-foreground p-2.5 resize-y focus:outline-none focus:border-primary placeholder:text-muted-foreground/40"
                />
              ) : f.type === 'select' ? (
                <select
                  value={values[f.key] ?? ''}
                  onChange={e => set(f.key, e.target.value)}
                  className="w-full bg-background border border-border rounded text-xs font-mono text-foreground px-2.5 py-2 focus:outline-none focus:border-primary"
                >
                  <option value="">— select —</option>
                  {(options[f.key] ?? []).map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              ) : f.isSlug ? (
                <input
                  type="text"
                  value={values[f.key] ?? ''}
                  onChange={e => setSlug(f.key, e.target.value)}
                  placeholder={f.placeholder ?? 'auto-generated'}
                  className="w-full bg-background border border-border rounded text-xs font-mono text-muted-foreground px-2.5 py-2 focus:outline-none focus:border-primary placeholder:text-muted-foreground/30"
                />
              ) : (
                <input
                  type="text"
                  value={values[f.key] ?? ''}
                  onChange={e => set(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  className="w-full bg-background border border-border rounded text-xs font-mono text-foreground px-2.5 py-2 focus:outline-none focus:border-primary placeholder:text-muted-foreground/40"
                />
              )}
            </div>
          ))}

          {extraContent && (
            <div className="pt-3 mt-1 border-t border-border">
              {extraContent}
            </div>
          )}

          {error && (
            <div className="font-mono text-[11px] px-3 py-2 rounded bg-destructive/10 text-destructive border border-destructive/20">
              {error}
            </div>
          )}
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving} className="flex-1">
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
