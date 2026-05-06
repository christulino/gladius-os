import { useState, useRef, useEffect } from 'react'

export default function JQLEditor({ value, onChange, onRun, mode, onModeChange, fieldCatalog, error, translatorAvailable }) {
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const inputRef = useRef(null)

  useEffect(() => {
    if (mode !== 'jql' || !fieldCatalog) { setShowSuggestions(false); return }
    const cursor = inputRef.current?.selectionStart ?? value.length
    const before = value.slice(0, cursor)
    const m = before.match(/[a-zA-Z_][a-zA-Z0-9_]*$/)
    if (!m) { setShowSuggestions(false); return }
    const token = m[0].toLowerCase()
    const all = [...fieldCatalog.native, ...fieldCatalog.custom].map(f => f.key)
    const matches = all.filter(k => k.toLowerCase().startsWith(token) && k !== m[0]).slice(0, 8)
    setSuggestions(matches)
    setShowSuggestions(matches.length > 0)
  }, [value, mode, fieldCatalog])

  const insertSuggestion = (s) => {
    const cursor = inputRef.current?.selectionStart ?? value.length
    const before = value.slice(0, cursor).replace(/[a-zA-Z_][a-zA-Z0-9_]*$/, s)
    const after = value.slice(cursor)
    onChange(before + after)
    setShowSuggestions(false)
    inputRef.current?.focus()
  }

  return (
    <div className="border border-border rounded bg-card">
      <div className="flex items-center gap-2 p-2">
        <div className="flex rounded overflow-hidden border border-border">
          <button
            onClick={() => onModeChange('jql')}
            className={`px-2 py-1 text-xs ${mode === 'jql' ? 'bg-primary text-primary-foreground' : 'bg-transparent'}`}
          >JQL</button>
          <button
            onClick={() => onModeChange('ask')}
            disabled={!translatorAvailable}
            title={translatorAvailable ? '' : 'AI translation requires ANTHROPIC_API_KEY in server config'}
            className={`px-2 py-1 text-xs ${mode === 'ask' ? 'bg-primary text-primary-foreground' : 'bg-transparent'} disabled:opacity-50 disabled:cursor-not-allowed`}
          >Ask</button>
        </div>
        <div className="relative flex-1">
          <input
            ref={inputRef}
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onRun() }
              if (e.key === 'Escape') setShowSuggestions(false)
            }}
            className="w-full text-sm bg-transparent outline-none tracking-tight"
            placeholder={mode === 'jql' ? 'priority >= 2 AND assignee = currentUser()' : 'Describe what you want to find…'}
          />
          {showSuggestions && (
            <ul className="absolute top-full left-0 mt-1 bg-card border border-border rounded shadow-md z-10 text-xs">
              {suggestions.map(s => (
                <li key={s}>
                  <button
                    onMouseDown={(e) => { e.preventDefault(); insertSuggestion(s) }}
                    className="block w-full text-left px-3 py-1 hover:bg-black/[0.03]"
                  >{s}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button onClick={onRun} className="text-xs px-3 py-1 rounded bg-primary text-primary-foreground">Run</button>
      </div>
      {error && <div className="px-3 pb-2 text-xs text-destructive">{error}</div>}
    </div>
  )
}
