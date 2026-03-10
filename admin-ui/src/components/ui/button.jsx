import { forwardRef } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center font-mono text-xs font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        default:  'bg-primary text-primary-foreground hover:bg-primary/90 rounded',
        outline:  'border border-border text-muted-foreground hover:border-foreground hover:text-foreground rounded',
        ghost:    'text-muted-foreground hover:text-foreground hover:bg-white/5 rounded',
        danger:   'border border-destructive/40 text-destructive hover:bg-destructive/10 rounded',
        accent:   'border border-accent/40 text-accent hover:bg-accent/10 rounded',
      },
      size: {
        default: 'h-7 px-3',
        sm:      'h-6 px-2 text-[10px]',
        lg:      'h-9 px-4',
        icon:    'h-7 w-7',
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
