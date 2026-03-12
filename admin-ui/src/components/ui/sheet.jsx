import { forwardRef } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const Sheet        = DialogPrimitive.Root
const SheetTrigger = DialogPrimitive.Trigger
const SheetClose   = DialogPrimitive.Close
const SheetPortal  = DialogPrimitive.Portal

const SheetOverlay = forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    className={cn('fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0', className)}
    {...props} ref={ref}
  />
))
SheetOverlay.displayName = 'SheetOverlay'

const SheetContent = forwardRef(({ className, children, side = 'right', overlay = true, ...props }, ref) => (
  <SheetPortal>
    {overlay && <SheetOverlay />}
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed z-50 flex flex-col bg-card border-l border-border shadow-xl transition ease-in-out',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-200 data-[state=open]:duration-200',
        side === 'right' && 'inset-y-0 right-0 w-[420px] data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 text-muted-foreground hover:text-foreground transition-colors">
        <X className="h-4 w-4" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </SheetPortal>
))
SheetContent.displayName = 'SheetContent'

const SheetHeader = ({ className, ...props }) => (
  <div className={cn('flex flex-col gap-1 p-4 border-b border-border', className)} {...props} />
)
const SheetTitle = forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn('text-sm font-semibold text-foreground', className)} {...props} />
))
SheetTitle.displayName = 'SheetTitle'
const SheetDescription = forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('text-xs text-muted-foreground', className)} {...props} />
))
SheetDescription.displayName = 'SheetDescription'

const SheetFooter = ({ className, ...props }) => (
  <div className={cn('flex gap-2 p-4 border-t border-border mt-auto', className)} {...props} />
)

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter }
