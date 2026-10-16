import { useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogTitle,
  DialogDescription,
} from './dialog'
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean
  onOpenChange: (value: boolean) => void
  title: string
  description?: string
  children: ReactNode
  wide?: boolean
}) {
  const returnFocus = useRef<HTMLElement | null>(null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={() => {
          returnFocus.current = document.activeElement as HTMLElement
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          if (returnFocus.current?.isConnected) returnFocus.current.focus()
        }}
        className={wide ? 'dialog-wide' : ''}
      >
        <div className="dialog-heading">
          <DialogTitle>{title}</DialogTitle>
          <DialogClose
            className="button button-ghost button-icon"
            aria-label="Đóng"
          >
            <X size={18} />
          </DialogClose>
        </div>
        <DialogDescription
          className={description ? 'dialog-description' : 'sr-only'}
        >
          {description || title}
        </DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  )
}
