import { useEffect, useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { notificationsApi } from '@/lib/api'
import { WorkItemDetail } from '@/components/WorkItemDetail'

function groupByDay(rows) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const yday  = new Date(today); yday.setDate(today.getDate() - 1)
  const g = { Today: [], Yesterday: [], Earlier: [] }
  for (const r of rows) {
    const d = new Date(r.created_at)
    if (d >= today)     g.Today.push(r)
    else if (d >= yday) g.Yesterday.push(r)
    else                g.Earlier.push(r)
  }
  return g
}

export default function NotificationsDrawer({ open, onOpenChange }) {
  const [rows, setRows]         = useState([])
  const [filter, setFilter]     = useState('unread')
  const [detailItemId, setDetailItemId] = useState(null)
  const [detailOpen, setDetailOpen]     = useState(false)

  async function load() {
    try {
      const res = await notificationsApi.list({
        unread_only: filter === 'unread' ? 'true' : undefined,
        limit: 50,
      })
      setRows(res.rows || [])
    } catch {}
  }

  useEffect(() => { if (open) load() }, [open, filter])

  async function markAll() {
    await notificationsApi.markReadBulk({})
    load()
  }

  async function openItem(row) {
    await notificationsApi.markRead(row.id)
    onOpenChange(false)
    setDetailItemId(row.work_item_id)
    setDetailOpen(true)
  }

  const groups = groupByDay(rows)

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange} overlay={false}>
        <SheetContent side="right" className="w-[420px] flex flex-col">
          <SheetHeader className="flex flex-row items-center justify-between pb-2 flex-shrink-0">
            <SheetTitle className="text-sm">Notifications</SheetTitle>
            <Button onClick={markAll} variant="ghost" className="text-xs h-6 px-2">Mark all read</Button>
          </SheetHeader>

          <div className="flex gap-2 text-xs flex-shrink-0">
            {['unread', 'all'].map(k => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`px-2 py-1 rounded ${filter === k ? 'bg-black/[0.05]' : 'hover:bg-black/[0.03]'}`}
              >
                {k === 'unread' ? 'Unread' : 'All'}
              </button>
            ))}
          </div>

          <div className="mt-3 flex-1 overflow-y-auto space-y-4">
            {Object.entries(groups).map(([label, items]) =>
              items.length === 0 ? null : (
                <section key={label}>
                  <div className="text-xs uppercase tracking-wide font-medium text-muted-foreground mb-1 px-1">
                    {label}
                  </div>
                  {items.map(row => (
                    <button
                      key={row.id}
                      onClick={() => openItem(row)}
                      className={[
                        'w-full text-left px-2 py-2 rounded hover:bg-black/[0.03] transition-colors',
                        !row.read_at ? 'font-medium border-l-2 border-[hsl(var(--primary))]' : '',
                      ].join(' ')}
                    >
                      <div className="text-xs leading-snug">{row.summary}</div>
                      <div className="text-xs text-muted-foreground flex flex-wrap gap-1 mt-0.5">
                        {(row.reasons || []).map(r => (
                          <span key={r} className="px-1 bg-black/[0.04] rounded">{r}</span>
                        ))}
                        <span className="ml-auto text-muted-foreground/60">
                          {new Date(row.created_at).toLocaleString()}
                        </span>
                      </div>
                    </button>
                  ))}
                </section>
              )
            )}
            {rows.length === 0 && (
              <div className="text-xs text-muted-foreground px-1">Nothing here.</div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <WorkItemDetail
        workItemId={detailItemId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </>
  )
}
