/**
 * MarkdownRenderer — shared lightweight Markdown renderer.
 *
 * Supports: headings (h1–h3), unordered and ordered lists, tables,
 * inline code, bold, and paragraph text.  Input is stored as plain
 * Markdown text; this component renders it for display only.  Edit
 * surfaces remain plain textareas.
 *
 * Used by: ContextEntryCard (journal), WorkItemDetail (description +
 * comments).  Keep this file as the single rendering path — do not
 * inline ad-hoc markdown parsing elsewhere.
 */

function renderInline(text) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/)
  return parts.map((p, i) => {
    if (p.startsWith('`') && p.endsWith('`'))
      return <code key={i} className="bg-muted px-1 rounded text-xs">{p.slice(1, -1)}</code>
    if (p.startsWith('**') && p.endsWith('**'))
      return <strong key={i} className="font-semibold">{p.slice(2, -2)}</strong>
    return p
  })
}

export function MarkdownRenderer({ content, className = '' }) {
  if (!content) return null
  const lines = content.split('\n')
  const elements = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Table detection
    if (line.startsWith('|') && lines[i + 1]?.match(/^\|[-| :]+\|$/)) {
      const headers = line.split('|').filter(Boolean).map(h => h.trim())
      i += 2
      const rows = []
      while (i < lines.length && lines[i].startsWith('|')) {
        rows.push(lines[i].split('|').filter(Boolean).map(c => c.trim()))
        i++
      }
      elements.push(
        <table key={`t${i}`} className="w-full text-xs border-collapse my-2">
          <thead>
            <tr>{headers.map((h, j) => <th key={j} className="border border-border px-2 py-1 text-left bg-muted font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className={ri % 2 === 0 ? '' : 'bg-muted/30'}>
                {row.map((cell, ci) => <td key={ci} className="border border-border px-2 py-1">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )
      continue
    }

    if (line.startsWith('### '))
      elements.push(<h3 key={i} className="text-xs font-bold text-foreground mt-3 mb-1">{line.slice(4)}</h3>)
    else if (line.startsWith('## '))
      elements.push(<h2 key={i} className="text-sm font-bold text-foreground mt-3 mb-1">{line.slice(3)}</h2>)
    else if (line.startsWith('# '))
      elements.push(<h2 key={i} className="text-sm font-bold text-foreground mt-3 mb-1">{line.slice(2)}</h2>)
    else if (line.match(/^[-*] /))
      elements.push(<li key={i} className="text-xs text-foreground ml-3 list-disc">{renderInline(line.slice(2))}</li>)
    else if (line.match(/^\d+\. /))
      elements.push(<li key={i} className="text-xs text-foreground ml-3 list-decimal">{renderInline(line.replace(/^\d+\. /, ''))}</li>)
    else if (line.trim() === '')
      elements.push(<div key={i} className="h-1" />)
    else
      elements.push(<p key={i} className="text-xs text-foreground leading-relaxed">{renderInline(line)}</p>)

    i++
  }
  return <div className={`flex flex-col gap-0.5 ${className}`.trim()}>{elements}</div>
}
