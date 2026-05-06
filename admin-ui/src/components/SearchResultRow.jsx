// Splits a ts_headline string ("...<mark>term</mark>...") and renders <mark>
// as a real React element. Avoids HTML injection — every character flows
// through React's normal text-node escaping.
function SnippetText({ html }) {
  if (!html) return null
  const parts = []
  let last = 0
  for (const m of html.matchAll(/<mark>(.*?)<\/mark>/g)) {
    if (m.index > last) parts.push(html.slice(last, m.index))
    parts.push(<mark key={parts.length} className="bg-amber-200/60 rounded px-0.5">{m[1]}</mark>)
    last = m.index + m[0].length
  }
  if (last < html.length) parts.push(html.slice(last))
  return <>…{parts}…</>
}

export default function SearchResultRow({ row, onOpen }) {
  return (
    <li
      onClick={() => onOpen(row.id)}
      className="border-b border-border/50 px-3 py-2 cursor-pointer hover:bg-black/[0.03]"
    >
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-medium text-foreground/60 shrink-0">{row.display_key}</span>
        <span className="text-sm truncate">{row.title}</span>
      </div>
      <div className="text-xs text-foreground/60 mt-0.5">
        {row.status} · priority {row.priority ?? '—'} · {row.assignee_name || 'unassigned'}
        {row.updated_at && <> · updated {new Date(row.updated_at).toLocaleDateString()}</>}
      </div>
      {row.snippet && (
        <div className="text-xs text-foreground/70 mt-1 italic">
          <SnippetText html={row.snippet} />
        </div>
      )}
    </li>
  )
}
