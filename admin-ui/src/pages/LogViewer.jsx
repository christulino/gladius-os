import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Panel, PanelHeader, PanelTitle } from '@/components/Panel'
import { cn } from '@/lib/utils'

const LEVEL_COLOR = {
  log:   'text-muted-foreground',
  info:  'text-accent',
  warn:  'text-orange-400',
  error: 'text-destructive',
  debug: 'text-muted-foreground/60',
}

export default function LogViewer() {
  const [entries,    setEntries]    = useState([])
  const [filter,     setFilter]     = useState('all')
  const [connected,  setConnected]  = useState(false)
  const [autoscroll, setAutoscroll] = useState(true)
  const scrollRef  = useRef(null)
  const esRef      = useRef(null)

  useEffect(() => {
    const es = new EventSource('/admin/api/logs/stream')
    esRef.current = es

    es.onopen    = () => setConnected(true)
    es.onerror   = () => setConnected(false)
    es.onmessage = (e) => {
      try {
        const entry = JSON.parse(e.data)
        setEntries(prev => [...prev.slice(-999), entry]) // keep last 1000
      } catch {}
    }
    return () => es.close()
  }, [])

  useEffect(() => {
    if (autoscroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries, autoscroll])

  const visible = filter === 'all' ? entries : entries.filter(e => e.level === filter)

  const FILTERS = ['all', 'log', 'info', 'warn', 'error']

  return (
    <Panel className="flex-1 min-h-0">
      <PanelHeader>
        <PanelTitle>Log Viewer</PanelTitle>
        <div className="flex items-center gap-2">
          <span className={cn('text-xs', connected ? 'text-primary' : 'text-muted-foreground')}>
            {connected ? '● live' : '○ disconnected'}
          </span>
          <div className="flex gap-1">
            {FILTERS.map(f => (
              <Button key={f} size="sm"
                variant={filter === f ? (f === 'warn' ? 'outline' : f === 'error' ? 'danger' : 'accent') : 'ghost'}
                className={filter === f && f === 'warn' ? 'border-orange-400/40 text-orange-400' : ''}
                onClick={() => setFilter(f)}
              >{f}</Button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer ml-1">
            <input type="checkbox" checked={autoscroll} onChange={e => setAutoscroll(e.target.checked)} className="w-3 h-3" />
            autoscroll
          </label>
          <Button size="sm" variant="ghost"
            className="text-destructive/60 hover:text-destructive"
            onClick={() => setEntries([])}
          >clear</Button>
        </div>
      </PanelHeader>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
            {connected ? 'Waiting for logs...' : 'Connecting...'}
          </div>
        ) : visible.map((entry, i) => {
          const ts = new Date(entry.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
          return (
            <div key={entry.id ?? i}
              className="grid border-b border-border/40 hover:bg-black/[0.03] transition-colors py-0.5"
              style={{ gridTemplateColumns: '72px 40px 1fr' }}
            >
              <span className="px-3 text-xs text-muted-foreground py-1">{ts}</span>
              <span className={cn('text-xs py-1 text-center', LEVEL_COLOR[entry.level] ?? 'text-muted-foreground')}>
                {entry.level}
              </span>
              <span className={cn('text-xs px-2 py-1 break-all whitespace-pre-wrap', LEVEL_COLOR[entry.level] ?? 'text-foreground')}>
                {entry.message}
              </span>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}
