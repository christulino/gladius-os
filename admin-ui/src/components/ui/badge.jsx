import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded px-2 py-0.5 font-mono text-[10px] font-medium transition-colors',
  {
    variants: {
      variant: {
        default:  'bg-primary/12 text-primary border border-primary/20',
        blue:     'bg-accent/10 text-accent border border-accent/20',
        amber:    'bg-[hsl(var(--map-amber))]/10 text-[hsl(var(--map-amber))] border border-[hsl(var(--map-amber))]/20',
        orange:   'bg-[hsl(var(--map-amber))]/10 text-[hsl(var(--map-amber))] border border-[hsl(var(--map-amber))]/20',
        red:      'bg-destructive/10 text-destructive border border-destructive/20',
        brown:    'bg-[hsl(var(--map-brown))]/10 text-[hsl(var(--map-brown))] border border-[hsl(var(--map-brown))]/20',
        muted:    'bg-muted text-muted-foreground border border-border',
        outline:  'border border-border text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

export function Badge({ className, variant, ...props }) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}
