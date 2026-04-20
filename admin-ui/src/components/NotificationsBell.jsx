import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { notificationsApi } from '@/lib/api'

export default function NotificationsBell({ onClick }) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let alive = true

    async function poll() {
      try {
        const { unread_count } = await notificationsApi.list({ limit: 1 })
        if (alive) setCount(unread_count || 0)
      } catch {}
    }

    poll()
    const t = setInterval(poll, 30_000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  return (
    <button
      onClick={onClick}
      className="relative p-1 rounded hover:bg-black/[0.03] text-muted-foreground hover:text-foreground transition-colors"
      aria-label="Notifications"
    >
      <Bell className="w-3.5 h-3.5" />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-0.5
                         rounded-full bg-[hsl(var(--destructive))] text-white text-[9px]
                         flex items-center justify-center leading-none">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  )
}
