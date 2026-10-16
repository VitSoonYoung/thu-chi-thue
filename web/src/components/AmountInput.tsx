import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useEffect,
  type ReactNode,
  useRef,
  useState,
} from 'react'
import { ArrowUpRight, ArrowDownLeft, X } from 'lucide-react'
import { formatAmount, parseAmount } from '../lib'
import { formatUSD, parseUSD, usdToVND, validRate } from '../forex'
type Edit = { text: string; caret: number; usd: string }
export const AmountInput = forwardRef<
  HTMLInputElement,
  {
    initial?: string
    initialUSD?: string
    rate: string
    rateControl: ReactNode
    onUSDChange: (usd: string) => void
    onValue: (amount: bigint | null) => void
    onTextChange?: (text: string) => void
    collapsed?: boolean
    clearable?: boolean
    disabled?: boolean
    autoFocus?: boolean
    inputId?: string
  }
>(({ initial = '', initialUSD = '', rate, rateControl, onUSDChange, onValue, onTextChange, collapsed = false, clearable = false, disabled = false, autoFocus, inputId = 'amount' }, ref) => {
  const start = initial ? formatAmount(initial, true) : ''
  const [text, setText] = useState(start)
  const [error, setError] = useState('')
  const originalUSD = useRef(initialUSD)
  const input = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const caret = useRef<number | null>(null)
  const history = useRef<Edit[]>([{ text: start, caret: start.length, usd: initialUSD }])
  const cursor = useRef(0)
  useImperativeHandle(ref, () => input.current!)
  function resolve(next: string, usd: string) { return usd ? usdToVND(BigInt(usd), rate) : next.includes('$') ? null : parseAmount(next) }
  const value = resolve(text, originalUSD.current)
  const negative = text.includes('-')
  function apply(next: string, position: number, record = true, retainedUSD?: string) {
    const usd = retainedUSD ?? (next.includes('$') ? parseUSD(next)?.toString() || '' : '')
    originalUSD.current = usd
    onUSDChange(usd)
    if (record) {
      history.current = history.current.slice(0, cursor.current + 1)
      history.current.push({ text: next, caret: position, usd })
      cursor.current++
    }
    caret.current = position
    setText(next)
    onTextChange?.(next)
    setError('')
    onValue(resolve(next, usd))
  }
  function edit(raw: string, position: number) {
    if (raw.includes('$')) {
      if (!/^[+$\-\d.,\s]*$/.test(raw) || (raw.match(/\$/g) || []).length > 1) { setError('Nhập số USD hợp lệ'); return }
      apply(raw, position)
      return
    }
    if (!/^[+-]?[\d.]*$/.test(raw)) {
      setError('Chỉ nhập số nguyên và dấu cộng hoặc trừ')
      return
    }
    const digitsBefore = raw.slice(0, position).replace(/\D/g, '').length
    const digits = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
    const sign = raw.startsWith('-')
      ? '-'
      : digits
        ? '+'
        : raw.startsWith('+')
          ? '+'
          : ''
    const next = sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    let pos = sign.length,
      count = 0
    while (pos < next.length && count < digitsBefore) {
      if (/\d/.test(next[pos])) count++
      pos++
    }
    apply(next, position === 0 ? 0 : pos)
  }
  useEffect(() => {
    if (!originalUSD.current) return
    const converted = usdToVND(BigInt(originalUSD.current), rate)
    onValue(converted)
    if (converted !== null) setError('')
    if (converted !== null && (!text.includes('$') || document.activeElement !== input.current)) {
      const display = formatAmount(converted, true)
      setText(display)
      history.current = [{ text: display, caret: display.length, usd: originalUSD.current }]
      cursor.current = 0
    }
  }, [rate])
  useLayoutEffect(() => {
    if (input.current && caret.current !== null) {
      input.current.setSelectionRange(caret.current, caret.current)
      caret.current = null
    }
    function fit() {
      if (!input.current || !box.current) return
      const canvas = document.createElement('canvas'),
        context = canvas.getContext('2d')
      if (!context) return
      const style = getComputedStyle(input.current)
      let size = parseFloat(style.getPropertyValue('--amount-font-size')) || 30
      while (size > 14) {
        context.font = `780 ${size}px ${style.fontFamily}`
        if (
          context.measureText(text || 'Nhập thu chi').width <=
          input.current.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 3
        )
          break
        size--
      }
      input.current.style.fontSize = `${size}px`
    }
    fit()
    const observer = new ResizeObserver(fit)
    if (box.current) observer.observe(box.current)
    return () => observer.disconnect()
  }, [text])
  return (
    <div>
      <label className="sr-only" htmlFor={inputId}>
        <span>NHẬP SỐ TIỀN</span>
        <span>VND</span>
      </label>
      <div
        ref={box}
        className={
          'amount-box' +
          (collapsed ? ' is-collapsed' : '') +
          (negative ? ' is-expense' : '') +
          (error ? ' has-error' : '')
        }
      >
        <div id={`${inputId}-help`} className="amount-helper" hidden={collapsed}>
          <span className="amount-kind">
            {negative ? (
              <ArrowDownLeft size={12} />
            ) : (
              <ArrowUpRight size={12} />
            )}
            {negative ? 'Khoản chi' : 'Khoản thu'}
          </span>
          {rateControl}
        </div>
        <div className="amount-line">
          {clearable && text && <button type="button" className="amount-clear" aria-label="Xóa số tiền" title="Xóa số tiền" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => { apply('', 0); input.current?.focus({ preventScroll: true }) }}><X size={16} /></button>}
          <input
            id={inputId}
            ref={input}
            autoFocus={autoFocus}
            disabled={disabled}
            value={text}
            placeholder="Nhập thu chi"
            inputMode="text"
            autoComplete="off"
            aria-describedby={`${inputId}-help ${inputId}-error`}
            onChange={(e) => edit(e.target.value, e.target.selectionStart || 0)}
            onBlur={() => {
              if (!text.includes('$')) return
              const cents = parseUSD(text)
              if (cents === null) { setError('Nhập số USD hợp lệ, tối đa 2 chữ số thập phân'); return }
              const converted = usdToVND(cents, rate)
              if (converted === null) { setError(validRate(rate) ? 'Số tiền vượt giới hạn VND' : 'Nhập tỷ giá USD để quy đổi'); return }
              const display = formatAmount(converted, true)
              apply(display, display.length, true, cents.toString())
            }}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData('text')
              if (pasted.includes('$')) {
                e.preventDefault()
                if (parseUSD(pasted) === null) { setError('Số USD không hợp lệ'); return }
                const start = input.current?.selectionStart || 0, end = input.current?.selectionEnd || 0
                edit(text.slice(0, start) + pasted.trim() + text.slice(end), start + pasted.trim().length)
                return
              }
              const n = parseAmount(pasted)
              if (n === null) {
                e.preventDefault()
                setError('Số tiền không hợp lệ hoặc vượt giới hạn VND')
                return
              }
              e.preventDefault()
              const start = input.current?.selectionStart || 0,
                end = input.current?.selectionEnd || 0
              if ((start === 0 && end === text.length) || text === '') {
                const next = formatAmount(n, true)
                apply(next, next.length)
              } else {
                const raw =
                  text.slice(0, start) +
                  pasted.replace(/[.,]/g, '') +
                  text.slice(end)
                edit(raw, start + pasted.replace(/[.,]/g, '').length)
              }
            }}
            onKeyDown={(e) => {
              const el = e.currentTarget,
                start = el.selectionStart || 0,
                end = el.selectionEnd || 0
              if (
                (e.metaKey || e.ctrlKey) &&
                ['z', 'y'].includes(e.key.toLowerCase())
              ) {
                e.preventDefault()
                const forward = e.shiftKey || e.key.toLowerCase() === 'y'
                cursor.current = Math.max(
                  0,
                  Math.min(
                    history.current.length - 1,
                    cursor.current + (forward ? 1 : -1),
                  ),
                )
                const state = history.current[cursor.current]
                apply(state.text, state.caret, false, state.usd)
              } else if (
                start === end &&
                e.key === 'Backspace' &&
                !text.includes('$') && text[start - 1] === '.'
              ) {
                e.preventDefault()
                edit(text.slice(0, start - 2) + text.slice(start), start - 2)
              } else if (
                start === end &&
                e.key === 'Delete' &&
                !text.includes('$') && text[start] === '.'
              ) {
                e.preventDefault()
                edit(text.slice(0, start) + text.slice(start + 2), start)
              }
            }}
          />
          <span className="amount-unit">{!text || text.includes('$') ? '' : '₫'}</span>
        </div>
        {originalUSD.current && !text.includes('$') && <div className="amount-usd-hint">{formatUSD(originalUSD.current)}</div>}
      </div>
      <div id={`${inputId}-error`} className="field-error" role="alert">
        {error ||
          (text && value === null && !['+', '-', '$', '-$', '+$', '$-', '$+'].includes(text)
            ? text.includes('$') && parseUSD(text) === null ? 'Số USD không hợp lệ' : originalUSD.current && !validRate(rate) ? 'Nhập tỷ giá USD để quy đổi' : 'Số tiền vượt giới hạn VND'
            : '')}
      </div>
    </div>
  )
})
AmountInput.displayName = 'AmountInput'
