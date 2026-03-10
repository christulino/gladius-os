import { cn } from '@/lib/utils'

export function Panel({ className, children }) {
  return (
    <div className={cn('bg-card border border-border rounded-md overflow-hidden flex flex-col', className)}>
      {children}
    </div>
  )
}

export function PanelHeader({ className, children }) {
  return (
    <div className={cn('flex items-center justify-between px-4 py-2.5 border-b border-border flex-shrink-0', className)}>
      {children}
    </div>
  )
}

export function PanelTitle({ children }) {
  return <span className="font-mono text-[11px] uppercase tracking-wider text-primary">{children}</span>
}

export function PanelMeta({ children }) {
  return <span className="font-mono text-[11px] text-muted-foreground">{children}</span>
}

export function LoadingState() {
  return <div className="flex-1 flex items-center justify-center text-muted-foreground font-mono text-xs py-16">Loading...</div>
}

export function ErrorState({ message }) {
  return <div className="flex-1 flex items-center justify-center text-destructive font-mono text-xs py-16">{message}</div>
}

export function EmptyState({ message = 'No data' }) {
  return <div className="flex-1 flex items-center justify-center text-muted-foreground font-mono text-xs py-16">{message}</div>
}
