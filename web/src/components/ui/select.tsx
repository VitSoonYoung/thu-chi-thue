import { useRef } from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'

type Option = { value: string; label: string; disabled?: boolean; action?: () => void }

export function Select({ value, onValueChange, options, label, className = '' }: {
  value: string
  onValueChange: (value: string) => void
  options: Option[]
  label: string
  className?: string
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  const pendingAction = useRef<(() => void) | null>(null)
  return (
    <SelectPrimitive.Root value={value} onValueChange={next => {
      const action = options.find(option => option.value === next)?.action
      if (action) pendingAction.current = action
      else onValueChange(next)
    }}>
      <SelectPrimitive.Trigger ref={trigger} className={'select-trigger ' + className} aria-label={label}>
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon><ChevronDown size={16} /></SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="select-content" position="popper" sideOffset={5} collisionPadding={12}
          onCloseAutoFocus={event => {
            const action = pendingAction.current
            if (!action) return
            event.preventDefault()
            pendingAction.current = null
            trigger.current?.focus()
            action()
          }}>
          <SelectPrimitive.ScrollUpButton className="select-scroll"><ChevronUp size={15} /></SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="select-viewport">
            {options.map(option => (
              <SelectPrimitive.Item className="select-item" key={option.value} value={option.value} disabled={option.disabled}>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="select-indicator"><Check size={15} /></SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="select-scroll"><ChevronDown size={15} /></SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
