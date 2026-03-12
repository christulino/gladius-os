import { useState, useEffect, useRef } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Panel, PanelHeader, PanelTitle, PanelMeta } from '@/components/Panel'
import { cn } from '@/lib/utils'

const STATE_COLORS = {
  idle:    'text-muted-foreground',
  running: 'text-primary',
  paused:  'text-orange-500',
}

const STATE_DOT = {
  idle:    'bg-muted-foreground',
  running: 'bg-primary',
  paused:  'bg-orange-500',
}

export default function Simulation() {
  const [status, setStatus]     = useState(null)
  const [entries, setEntries]   = useState([])
  const [connected, setConnected] = useState(false)
  const [speed, setSpeed]       = useState(1)
  const scrollRef = useRef(null)
  const esRef     = useRef(null)

  // Poll status every 3s
  useEffect(() => {
    loadStatus()
    const interval = setInterval(loadStatus, 3000)
    return () => clearInterval(interval)
  }, [])

  // SSE activity stream
  useEffect(() => {
    const es = new EventSource('/admin/api/simulation/stream')
    esRef.current = es
    es.onopen    = () => setConnected(true)
    es.onerror   = () => setConnected(false)
    es.onmessage = (e) => {
      try {
        const entry = JSON.parse(e.data)
        setEntries(prev => [...prev.slice(-499), entry])
      } catch {}
    }
    return () => es.close()
  }, [])

  // Autoscroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries])

  async function loadStatus() {
    try {
      const s = await api.simulationStatus()
      setStatus(s)
      setSpeed(s.speed || 1)
    } catch {}
  }

  async function handleStart() {
    try {
      await api.simulationStart({ speed })
      await loadStatus()
    } catch (err) { console.error(err) }
  }

  async function handleStop() {
    try {
      await api.simulationStop()
      await loadStatus()
    } catch (err) { console.error(err) }
  }

  async function handlePause() {
    try {
      await api.simulationPause()
      await loadStatus()
    } catch (err) { console.error(err) }
  }

  async function handleResume() {
    try {
      await api.simulationResume()
      await loadStatus()
    } catch (err) { console.error(err) }
  }

  async function handleSpeedChange(newSpeed) {
    setSpeed(newSpeed)
    try {
      await api.simulationSpeed(newSpeed)
      await loadStatus()
    } catch (err) { console.error(err) }
  }

  const state = status?.state || 'idle'

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Controls */}
      <Panel>
        <PanelHeader>
          <div className="flex items-center gap-3">
            <PanelTitle>Simulation</PanelTitle>
            <span className={cn('flex items-center gap-1.5 text-xs font-medium', STATE_COLORS[state])}>
              <span className={cn('w-2 h-2 rounded-full', STATE_DOT[state], state === 'running' && 'animate-pulse')} />
              {state}
            </span>
            {status && (
              <PanelMeta>
                tick {status.tickCount} | {status.worldState?.workItems || 0} active items
              </PanelMeta>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className={cn('text-xs', connected ? 'text-primary' : 'text-muted-foreground')}>
              {connected ? '● stream' : '○ disconnected'}
            </span>
            {state === 'idle' && (
              <Button size="sm" variant="default" onClick={handleStart}>Start</Button>
            )}
            {state === 'running' && (
              <>
                <Button size="sm" variant="outline" onClick={handlePause}>Pause</Button>
                <Button size="sm" variant="danger" onClick={handleStop}>Stop</Button>
              </>
            )}
            {state === 'paused' && (
              <>
                <Button size="sm" variant="default" onClick={handleResume}>Resume</Button>
                <Button size="sm" variant="danger" onClick={handleStop}>Stop</Button>
              </>
            )}
          </div>
        </PanelHeader>

        {/* Speed slider */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border">
          <span className="text-xs text-muted-foreground w-12">Speed</span>
          <input
            type="range" min="1" max="10" step="1"
            value={speed}
            onChange={(e) => handleSpeedChange(parseInt(e.target.value))}
            className="flex-1 h-1 accent-primary"
          />
          <span className="text-xs font-medium w-8 text-right">{speed}x</span>
        </div>
      </Panel>

      {/* Agent Cards */}
      {status?.agents?.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
          {status.agents.map((agent) => (
            <div key={agent.name} className="bg-card border border-border rounded-md p-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <span className={cn(
                  'w-1.5 h-1.5 rounded-full flex-shrink-0',
                  agent.cooldown > 0 ? 'bg-muted-foreground' : 'bg-primary'
                )} />
                <span className="text-xs font-medium text-foreground truncate">{agent.name}</span>
              </div>
              <div className="text-xs text-muted-foreground truncate">{agent.orgSlug}</div>
              <div className="text-xs text-muted-foreground truncate">{agent.role}</div>
              {agent.lastAction && (
                <div className="text-xs text-accent truncate mt-1">{agent.lastAction}</div>
              )}
              <div className="text-xs text-muted-foreground mt-0.5">{agent.actionCount} actions</div>
            </div>
          ))}
        </div>
      )}

      {/* Activity Feed */}
      <Panel className="flex-1 min-h-0">
        <PanelHeader>
          <PanelTitle>Activity Feed</PanelTitle>
          <div className="flex items-center gap-2">
            <PanelMeta>{entries.length} entries</PanelMeta>
            <Button size="sm" variant="ghost" onClick={() => setEntries([])}>clear</Button>
          </div>
        </PanelHeader>
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {entries.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
              {connected ? 'Waiting for activity...' : 'Connecting...'}
            </div>
          ) : entries.map((entry, i) => {
            const ts = new Date(entry.timestamp).toLocaleTimeString('en-US', {
              hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
            })
            const isError = entry.action === 'error'
            const isSystem = ['start', 'stop', 'pause', 'resume'].includes(entry.action)
            return (
              <div
                key={entry.id ?? i}
                className="grid border-b border-border/40 hover:bg-black/[0.03] transition-colors py-0.5"
                style={{ gridTemplateColumns: '68px 100px 80px 1fr' }}
              >
                <span className="px-3 text-xs text-muted-foreground py-1">{ts}</span>
                <span className={cn(
                  'text-xs py-1 truncate',
                  isSystem ? 'text-accent font-medium' : 'text-foreground',
                )}>{entry.agentName}</span>
                <span className={cn(
                  'text-xs py-1 truncate',
                  isError ? 'text-destructive' : 'text-muted-foreground',
                )}>{entry.action}</span>
                <span className="text-xs px-2 py-1 text-muted-foreground truncate">{entry.detail}</span>
              </div>
            )
          })}
        </div>
      </Panel>
    </div>
  )
}
