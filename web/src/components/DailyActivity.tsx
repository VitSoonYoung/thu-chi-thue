import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { formatAmount, type Transaction } from '../lib'

export function calendarDays(year: number, firstMonth = 0, endMonth = 12) {
  const start = new Date(Date.UTC(year, firstMonth, 1))
  const end = new Date(Date.UTC(year, endMonth, 1))
  const offset = (start.getUTCDay() + 6) % 7
  const days = []
  for (let time = start.getTime(); time < end.getTime(); time += 86400000) {
    const date = new Date(time)
    days.push({ date: date.toISOString().slice(0, 10), month: date.getUTCMonth(), day: date.getUTCDate() })
  }
  return { days, offset, weeks: Math.ceil((offset + days.length) / 7) }
}

export function dailyTotals(transactions: Transaction[]) {
  const result = new Map<string, { total: bigint; transactions: Transaction[] }>()
  for (const transaction of transactions) {
    const day = result.get(transaction.date) || { total: 0n, transactions: [] }
    day.total += BigInt(transaction.amount)
    day.transactions.push(transaction)
    result.set(transaction.date, day)
  }
  return result
}

function dateLabel(date: string) {
  return `${date.slice(8)}/${date.slice(5, 7)}/${date.slice(0, 4)}`
}

export function DailyActivity({ year, transactions, selectedDay, onSelect }: { year: number; transactions: Transaction[]; selectedDay: string | null; onSelect: (day: string) => void }) {
  const totals = useMemo(() => dailyTotals(transactions), [transactions])
  const halves = useMemo(() => [calendarDays(year, 0, 6), calendarDays(year, 6, 12)], [year])
  const [hover, setHover] = useState<{ date: string; left: number; top: number; above: boolean } | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [focusedDay, setFocusedDay] = useState(`${year}-01-01`)
  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current) }, [])
  function cancelHide() { if (hideTimer.current) clearTimeout(hideTimer.current) }
  function hide() { cancelHide(); hideTimer.current = setTimeout(() => setHover(null), 120) }
  const filled = [...totals.keys()].filter(date => date.startsWith(String(year))).length
  function show(date: string, element: HTMLElement) {
    cancelHide()
    const rect = element.getBoundingClientRect()
    const width = Math.min(288, window.innerWidth - 24)
    setHover({ date, left: Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12)), top: rect.top > 240 ? rect.top - 10 : rect.bottom + 10, above: rect.top > 240 })
  }
  const hovered = hover ? totals.get(hover.date) : undefined
  return <section className="daily-activity" aria-labelledby="activity-title">
    <div className="activity-heading"><h3 id="activity-title">Thu chi từng ngày</h3><span>{year}</span></div>
    <p className="activity-summary">{filled} ngày đã ghi giao dịch</p>
    <div className="activity-calendar" onMouseLeave={hide}>
      {halves.map((half, halfIndex) => <div key={halfIndex} className="activity-half">
        <div className="activity-months" style={{ gridTemplateColumns: `repeat(${half.weeks}, minmax(0, 1fr))` }}>
          {half.days.filter(day => day.day === 1).map(day => {
            const index = half.days.findIndex(candidate => candidate.date === day.date)
            return <span key={day.month} style={{ gridColumn: `${Math.floor((half.offset + index) / 7) + 1} / span 3` }}>T{day.month + 1}</span>
          })}
        </div>
        <div className="activity-grid" style={{ '--weeks': half.weeks } as CSSProperties} role="group" aria-label={halfIndex === 0 ? `Tháng 1 đến tháng 6 năm ${year}` : `Tháng 7 đến tháng 12 năm ${year}`}>
          {Array.from({ length: half.offset }, (_, index) => <span key={'empty' + index} className="activity-spacer" />)}
          {half.days.map(day => {
            const data = totals.get(day.date)
            const color = !data ? 'empty' : data.total > 0n ? 'positive' : data.total < 0n ? 'negative' : 'balanced'
            return <button key={day.date} type="button" className={'activity-day activity-' + color} data-date={day.date}
              aria-label={`${dateLabel(day.date)} · ${data ? `${data.transactions.length} giao dịch · ${formatAmount(data.total, true)} ₫` : 'Chưa có giao dịch'}`}
              aria-pressed={selectedDay === day.date} aria-describedby={hover?.date === day.date ? 'activity-tooltip' : undefined}
              tabIndex={focusedDay === day.date ? 0 : -1}
              onMouseEnter={event => show(day.date, event.currentTarget)} onFocus={event => { setFocusedDay(day.date); show(day.date, event.currentTarget) }} onBlur={hide}
              onKeyDown={event => {
                if (event.key === 'Escape') { setHover(null); return }
                const offsets: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }
                if (!(event.key in offsets)) return
                event.preventDefault()
                const next = new Date(Date.parse(day.date + 'T00:00:00Z') + offsets[event.key] * 86400000).toISOString().slice(0, 10)
                document.querySelector<HTMLButtonElement>(`.activity-day[data-date="${next}"]`)?.focus()
              }}
              onClick={() => { setHover(null); onSelect(day.date) }} />
          })}
        </div>
      </div>)}
    </div>
    <div className="activity-legend"><span><i className="activity-empty" />Chưa ghi</span><span><i className="activity-positive" />Dương</span><span><i className="activity-negative" />Âm</span></div>
    {hover && createPortal(<div id="activity-tooltip" role="tooltip" className="activity-tooltip" onMouseEnter={cancelHide} onMouseLeave={hide} style={{ left: hover.left, top: hover.top, transform: hover.above ? 'translateY(-100%)' : undefined }}>
      <strong>{dateLabel(hover.date)}</strong>
      {hovered ? <>
        <span className={'activity-tooltip-total ' + (hovered.total < 0n ? 'negative' : 'positive')}>Tổng ngày: {formatAmount(hovered.total, true)} ₫</span>
        <div className="activity-tooltip-records">{hovered.transactions.map(transaction => <div key={transaction.id}><span>{transaction.note || 'Giao dịch'}</span><b className={BigInt(transaction.amount) < 0n ? 'negative' : 'positive'}>{formatAmount(transaction.amount, true)} ₫</b></div>)}</div>
      </> : <span className="muted">Chưa có giao dịch</span>}
    </div>, document.body)}
  </section>
}
