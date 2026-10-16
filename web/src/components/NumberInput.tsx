import { useEffect, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from 'react'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'min' | 'max'> & {
  value: string | number
  onValueChange: (value: string) => void
  decimals?: number
  min?: number
  max?: number
}
export function formatNumberInput(value: string | number) {
  const [integer, fraction] = String(value).split('.')
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (fraction !== undefined ? ',' + fraction : '')
}
export function NumberInput({ value, onValueChange, decimals = 0, min = 0, max = Number.MAX_SAFE_INTEGER, ...props }: Props) {
  const [text, setText] = useState(() => formatNumberInput(value))
  const input = useRef<HTMLInputElement>(null)
  const lastValue = useRef(Number(value))
  const caret = useRef<number | null>(null)
  useEffect(() => {
    if (Number(value) !== lastValue.current) {
      lastValue.current = Number(value)
      setText(formatNumberInput(value))
    }
  }, [value])
  useLayoutEffect(() => {
    if (caret.current !== null) { input.current?.setSelectionRange(caret.current, caret.current); caret.current = null }
    const canonical = text.replace(/\./g, '').replace(',', '.')
    const n = Number(canonical)
    input.current?.setCustomValidity(text && (!Number.isFinite(n) || n < min || n > max) ? `Giá trị phải từ ${formatNumberInput(min)} đến ${formatNumberInput(max)}` : '')
  }, [text, min, max])
  function edit(raw: string, position: number) {
    if (!/^[\d.]*(?:,\d*)?$/.test(raw) || (!decimals && raw.includes(','))) return
    const [whole, fraction] = raw.replace(/\./g, '').split(',')
    if (fraction !== undefined && fraction.length > decimals) return
    const digits = whole.replace(/^0+(?=\d)/, '')
    const canonical = digits + (fraction !== undefined ? '.' + fraction : '')
    const next = formatNumberInput(canonical)
    const meaningful = raw.slice(0, position).replace(/\./g, '').length
    let count = 0, index = 0
    while (index < next.length && count < meaningful) { if (next[index] !== '.') count++; index++ }
    caret.current = index
    setText(next)
    lastValue.current = Number(canonical)
    onValueChange(canonical)
  }
  return <input {...props} ref={input} type="text" inputMode={decimals ? 'decimal' : 'numeric'} value={text} onChange={e => edit(e.target.value, e.target.selectionStart || 0)} onKeyDown={e => {
    props.onKeyDown?.(e)
    const start = e.currentTarget.selectionStart || 0, end = e.currentTarget.selectionEnd || 0
    if (start === end && e.key === 'Backspace' && text[start - 1] === '.') { e.preventDefault(); edit(text.slice(0, start - 2) + text.slice(start), start - 2) }
    if (start === end && e.key === 'Delete' && text[start] === '.') { e.preventDefault(); edit(text.slice(0, start) + text.slice(start + 2), start) }
  }} onPaste={e => {
    const raw = e.clipboardData.getData('text').trim()
    const valid = decimals ? /^\d+(?:[.,]\d{1,2})?$|^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/ : /^\d+$|^\d{1,3}(?:\.\d{3})+$/
    if (!valid.test(raw)) { e.preventDefault(); return }
    if (decimals && /^\d+\.\d{1,2}$/.test(raw)) { e.preventDefault(); const start = e.currentTarget.selectionStart || 0, end = e.currentTarget.selectionEnd || 0; const pasted = raw.replace('.', ','); edit(text.slice(0, start) + pasted + text.slice(end), start + pasted.length) }
  }} />
}
