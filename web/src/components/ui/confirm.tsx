import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from './alert-dialog'
import { Button } from './button'
import { useRef } from 'react'
export function Confirm({
  open,
  onOpenChange,
  title,
  description,
  action,
  busy,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  description: string
  action: string
  busy: boolean
  onConfirm: () => void
}) {
  const returnFocus = useRef<HTMLElement | null>(null)
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        onOpenAutoFocus={() => {
          returnFocus.current = document.activeElement as HTMLElement
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          if (returnFocus.current?.isConnected) returnFocus.current.focus()
        }}
      >
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription className="dialog-description">
          {description}
        </AlertDialogDescription>
        <div className="dialog-actions">
          <AlertDialogCancel asChild>
            <Button variant="outline" disabled={busy}>
              Hủy
            </Button>
          </AlertDialogCancel>
          <Button disabled={busy} onClick={onConfirm}>
            {busy ? 'Đang xử lý…' : action}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
