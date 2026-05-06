import SearchResultRow from './SearchResultRow'

export default function SearchResultsList({ rows, onOpen, onLoadMore, hasMore }) {
  if (rows.length === 0) return <div className="p-6 text-xs text-foreground/60">No results.</div>
  return (
    <div>
      <ul>{rows.map(r => <SearchResultRow key={r.id} row={r} onOpen={onOpen} />)}</ul>
      {hasMore && (
        <div className="p-3 text-center">
          <button onClick={onLoadMore} className="text-xs text-primary hover:underline">Load more</button>
        </div>
      )}
    </div>
  )
}
