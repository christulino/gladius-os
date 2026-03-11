import { forwardRef } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center text-xs font-medium rounded transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:  'bg-primary text-primary-foreground hover:bg-primary/90 rounded',
        outline:  'border border-border text-muted-foreground hover:border-foreground hover:text-foreground rounded',
        ghost:    'text-muted-foreground hover:text-foreground hover:bg-black/[0.04] rounded',
        danger:   'border border-destructive/40 text-destructive hover:bg-destructive/10 rounded',
        accent:   'border border-accent/40 text-accent hover:bg-accent/10 rounded',
      },
      size: {
        default: 'h-8 px-3',
        sm:      'h-7 px-2.5',
        lg:      'h-9 px-4',
        icon:    'h-8 w-8',
      },
    },
    defaultVariants: { variant: 'outline', size: 'default' },
  }
)

const Button = forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button'
  return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />
})
Button.displayName = 'Button'

export { Button, buttonVariants }
