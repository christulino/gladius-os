import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded px-2 py-0.5 font-mono text-[10px] font-medium transition-colors',
  {
    variants: {
      variant: {
        default:     'bg-primary/10 text-primary',
        blue:        'bg-accent/10 text-accent',
        orange:      'bg-orange-400/10 text-orange-400',
        red:         'bg-destructive/10 text-destructive',
        muted:       'bg-muted text-muted-foreground',
        outline:     'border border-border text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

export function Badge({ className, variant, ...props }) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}
