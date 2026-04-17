import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'
import { formatRelative } from '@/lib/utils'

export default function EventSubscribers() {
  const [subs, setSubs] = useState([])
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('')

  async function refresh() {
    const [subsRes, evRes] = await Promise.all([
      api.eventSubscribers(),
      api.recentEvents({ limit: 200, typePrefix: typeFilter || undefined }),
    ])
    setSubs(subsRes.rows)
    setEvents(evRes.rows)
    setLoading(false)
  }

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => clearInterval(timer)
  }, [typeFilter])

  async function togglePause(name, currentlyPaused) {
    await api.pauseEventSubscriber(name, !currentlyPaused)
    await refresh()
  }

  async function onSkip(name, eventId) {
    if (!confirm(`Skip past event ${eventId} for subscriber "${name}"?\n\nThe event will never be processed by this subscriber.`)) return
    await api.skipPastEvent(name, eventId)
    await refresh()
  }

  if (loading) {
    return <div className="p-6 text-xs text-muted-foreground">Loading…</div>
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-sm font-medium uppercase tracking-wide text-muted-foreground mb-3">Event Subscribers</h1>
        <div className="bg-card border border-border rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="border-b bg-black/[0.02]">
                <tr className="text-left">
                  <th className="p-2 font-medium uppercase tracking-wide">Name</th>
                  <th className="p-2 font-medium uppercase tracking-wide">Cursor</th>
                  <th className="p-2 font-medium uppercase tracking-wide">Processed</th>
                  <th className="p-2 font-medium uppercase tracking-wide">Last Success</th>
                  <th className="p-2 font-medium uppercase tracking-wide">Failures</th>
                  <th className="p-2 font-medium uppercase tracking-wide">Last Error</th>
                  <th className="p-2 font-medium uppercase tracking-wide">Paused</th>
                  <th className="p-2 font-medium uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {subs.map(s => (
                  <tr key={s.name} className="border-b hover:bg-black/[0.03]">
                    <td className="p-2 font-medium">{s.name}</td>
                    <td className="p-2">{s.last_processed_event_id}</td>
                    <td className="p-2">{s.events_processed_total}</td>
                    <td className="p-2 text-muted-foreground">{s.last_success_at ? formatRelative(s.last_success_at) : '—'}</td>
                    <td className="p-2">{s.failure_count > 0 ? <span className="text-destructive">{s.failure_count}</span> : s.failure_count}</td>
                    <td className="p-2 max-w-xs truncate" title={s.last_error || ''}>{s.last_error || '—'}</td>
                    <td className="p-2"><Switch checked={s.is_paused} onCheckedChange={() => togglePause(s.name, s.is_paused)} /></td>
                    <td className="p-2">
                      {s.failure_count > 0 && (
                        <Button size="sm" variant="outline" onClick={() => onSkip(s.name, Number(s.last_processed_event_id) + 1)}>
                          Skip next
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Recent Events</h2>
          <input
            type="text"
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            placeholder="filter by event_type prefix"
            className="h-7 px-2 text-xs border rounded w-56"
          />
        </div>
        <div className="bg-card border border-border rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="border-b bg-black/[0.02]">
                <tr className="text-left">
                  <th className="p-2 font-medium uppercase tracking-wide w-20">ID</th>
                  <th className="p-2 font-medium uppercase tracking-wide">Type</th>
                  <th className="p-2 font-medium uppercase tracking-wide w-20">Entity</th>
                  <th className="p-2 font-medium uppercase tracking-wide w-40">When</th>
                  <th className="p-2 font-medium uppercase tracking-wide">Payload</th>
                </tr>
              </thead>
              <tbody>
                {events.map(e => (
                  <tr key={e.id} className="border-b hover:bg-black/[0.03]">
                    <td className="p-2 font-medium">{e.id}</td>
                    <td className="p-2">{e.event_type}</td>
                    <td className="p-2">{e.entity_id}</td>
                    <td className="p-2 text-muted-foreground">{formatRelative(e.occurred_at)}</td>
                    <td className="p-2 max-w-md truncate" title={JSON.stringify(e.payload)}>{JSON.stringify(e.payload)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
        </div>
      </div>
    </div>
  )
}
