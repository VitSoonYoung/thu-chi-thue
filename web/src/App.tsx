import { DriveBackup } from './components/DriveBackup'
import { useTheme } from './theme'
import { DailyActivity } from './components/DailyActivity'
import { AccessSettings } from './components/AccessGate'
import { Select } from './components/ui/select'
import { formatUSD, validRate, vndToUSD } from './forex'
import { NumberInput } from './components/NumberInput'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Inbox,
  Settings,
  Moon,
  Sun,
  Upload,
  Trash2,
  Wallet,
  X,
} from 'lucide-react'
import { Toaster, toast } from 'sonner'
import {
  api,
  formatAmount,
  json,
  today,
  type State,
  type Tax,
  type Transaction,
} from './lib'
import { Button } from './components/ui/button'
import { Modal } from './components/ui/modal'
import { Confirm } from './components/ui/confirm'
import { TransactionForm } from './components/TransactionForm'
import { CategoryManager } from './components/CategoryManager'
import { CashChart } from './components/CashChart'
import { TaxPanel } from './components/TaxPanel'
function Money({ value, className = '', usd = null, rate = '' }: { value: bigint | string; className?: string; usd?: bigint | null; rate?: string }) {
  return <span className={'report-amount ' + (className.includes('negative') ? 'negative' : className.includes('positive') ? 'positive' : '')}>
    <span className={'money ' + className}>{formatAmount(value)}<span className="currency">₫</span></span>
    {usd !== null && <small className="report-usd" title={'Quy đổi theo tỷ giá 1 USD = ' + formatAmount(rate || '0') + ' ₫'}>{formatUSD(usd)}</small>}
  </span>
}
export default function App() {
  const { theme, toggleTheme } = useTheme()
  const [state, setState] = useState<State | null>(null)
  const [loadError, setLoadError] = useState('')
  const [tax, setTax] = useState<Tax | null>(null)
  const [year, setYear] = useState(Number(today().slice(0, 4)))
  const [date, setDate] = useState(today())
  const [usdRate, setUSDRate] = useState('25850')
  const [editDate, setEditDate] = useState(today())
  const [period, setPeriod] = useState(today().slice(0, 7))
  const [annual, setAnnual] = useState(false)
  const [allTime, setAllTime] = useState(false)
  const [cumulative, setCumulative] = useState(false)
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [categoryNew, setCategoryNew] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(() => new URLSearchParams(window.location.search).has('drive'))
  const [resetOpen, setResetOpen] = useState(false)
  const [resetPassword, setResetPassword] = useState('')
  const [resetError, setResetError] = useState('')
  const [resetBusy, setResetBusy] = useState(false)
  const [formVersion, setFormVersion] = useState(0)
  const [historyOpen, setHistoryOpen] = useState(false)
  const currentYear = Number(today().slice(0, 4))
  const [recentYear, setRecentYear] = useState(currentYear)
  const [recentMonthNumber, setRecentMonthNumber] = useState(Number(today().slice(5, 7)))
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [deleting, setDeleting] = useState<Transaction | null>(null)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [kindFilter, setKindFilter] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [restoring, setRestoring] = useState<File | null>(null)
  const [share, setShare] = useState('70')
  const [confirmed, setConfirmed] = useState(false)
  const restoreInput = useRef<HTMLInputElement>(null)
  const taxRequest = useRef(0)
  const refresh = useCallback(async () => {
    const next = await api<State>('/state')
    setState(next)
    setLoadError('')
  }, [])
  const refreshTax = useCallback(async () => {
    const request = ++taxRequest.current
    const next = await api<Tax>('/tax/' + year)
    if (request === taxRequest.current) setTax(next)
  }, [year])
  const refreshAll = useCallback(async () => {
    await refresh()
    await refreshTax()
  }, [refresh, refreshTax])
  useEffect(() => { setUSDRate(state?.settings.usd_rate === '0' ? '25850' : state?.settings.usd_rate || '25850') }, [state?.settings.usd_rate])
  async function saveUSDRate(value: string) {
    const rate = value || '0'
    if (rate !== '0' && !validRate(rate)) throw new Error('Tỷ giá USD không hợp lệ')
    await api('/settings', { ...json('PUT', { usd_rate: rate }), keepalive: true })
    setState(previous => previous ? { ...previous, settings: { ...previous.settings, usd_rate: rate } } : previous)
  }
  useEffect(() => {
    refresh().catch((e) => setLoadError(e.message))
  }, [refresh])
  useEffect(() => {
    setTax(null)
    refreshTax().catch((e) => toast.error(e.message))
  }, [refreshTax])
  useEffect(() => {
    if (state && settingsOpen) {
      setShare(String(Number(state.settings.share_bps) / 100))
      setConfirmed(state.settings.tax_confirmed === 'true')
    }
  }, [settingsOpen, state])
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('drive')
    if (!result) return
    if (result === 'connected') toast.success('Đã kết nối Google Drive')
    if (result === 'error') toast.error('Chưa kết nối được Google Drive. Hãy thử lại trong Cài đặt.')
    params.delete('drive')
    window.history.replaceState(null, '', window.location.pathname + (params.size ? '?' + params.toString() : '') + window.location.hash)
  }, [])
  function openCategories(fresh = false) {
    setCategoryNew(fresh)
    setCategoryOpen(true)
  }
  function edit(t: Transaction) {
    setEditDate(t.date)
    setEditing(t)
  }
  async function backup() {
    if (backupBusy) return
    setBackupBusy(true)
    try {
      const response = await fetch('/api/backup/download')
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Không thể tải bản sao lưu')
      }
      const blob = await response.blob()
      const name = response.headers
        .get('Content-Disposition')
        ?.match(/filename="([^"]+)"/)?.[1]
      if (!name) throw new Error('Tên bản sao lưu không hợp lệ')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.success('Đã tải bản sao lưu SQLite')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBackupBusy(false)
    }
  }
  function changePeriod(delta: number) {
    const [y, m] = period.split('-').map(Number)
    const d = new Date(
      y + (annual ? delta : 0),
      m - 1 + (annual ? 0 : delta),
      1,
    )
    setPeriod(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const records = state?.transactions || []
  const recentMonths = Array.from({ length: 12 }, (_, index) => `${recentYear}-${String(12 - index).padStart(2, '0')}`)
  const recentMonth = `${recentYear}-${String(recentMonthNumber).padStart(2, '0')}`
  const recentRecords = records.filter(t => t.date.startsWith(recentMonth))
  function selectMonth(month: string) {
    setRecentMonthNumber(Number(month.slice(5)))
    setSelectedDay(null)
  }
  function selectRecentYear(next: number) {
    setRecentYear(next)
    setSelectedDay(null)
    if (next === currentYear) setRecentMonthNumber(Number(today().slice(5, 7)))
  }
  function selectActivityDay(day: string) {
    setRecentYear(Number(day.slice(0, 4)))
    setRecentMonthNumber(Number(day.slice(5, 7)))
    setSelectedDay(day)
    setPeriod(day.slice(0, 7))
    setAnnual(false)
    setAllTime(false)
  }
  useEffect(() => { document.querySelector('.recent-transactions')?.scrollTo(0, 0) }, [recentMonth])
  useEffect(() => {
    if (!selectedDay) return
    const row = document.querySelector<HTMLElement>(`.recent-transactions [data-date="${selectedDay}"]`)
    const history = document.querySelector<HTMLElement>('.history-section')
    history?.scrollIntoView({ block: 'nearest' })
    row?.scrollIntoView({ block: 'nearest' })
  }, [selectedDay, recentMonth])
  useEffect(() => {
    function navigateRecent(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"], [role="combobox"], .daily-activity') || document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      event.preventDefault()
      setRecentMonthNumber(month => Math.max(1, Math.min(12, month + (event.key === 'ArrowRight' ? -1 : 1))))
      setSelectedDay(null)
      if (target?.closest('.transactions')) document.querySelector<HTMLElement>('.history-section')?.focus({ preventScroll: true })
    }
    window.addEventListener('keydown', navigateRecent)
    return () => window.removeEventListener('keydown', navigateRecent)
  }, [])
  const inPeriod = allTime ? records : records.filter((t) =>
    t.date.startsWith(annual ? period.slice(0, 4) : period),
  )
  let revenue = 0n,
    expenses = 0n
  for (const t of inPeriod) {
    const n = BigInt(t.amount)
    if (n > 0n) revenue += n
    else expenses -= n
  }
  const profit = revenue - expenses
  const filtered = records.filter(
    (t) =>
      (categoryFilter === 'all' || t.category_id === Number(categoryFilter)) &&
      (kindFilter === 'all' ||
        (BigInt(t.amount) > 0n ? 'income' : 'expense') === kindFilter) &&
      (!from || t.date >= from) &&
      (!to || t.date <= to) &&
      (!search ||
        (
          t.note +
          ' ' +
          state?.categories.find((c) => c.id === t.category_id)?.name
        )
          .toLocaleLowerCase('vi')
          .includes(search.toLocaleLowerCase('vi'))),
  )
  function rows(list: Transaction[]) {
    return list.map((t) => {
      const c = state?.categories.find((c) => c.id === t.category_id),
        income = BigInt(t.amount) > 0n
      return (
        <button
          key={t.id}
          className={'transaction-row' + (t.date === selectedDay ? ' transaction-highlighted' : '')}
          data-date={t.date}
          onClick={() => edit(t)}
          aria-label={'Mở giao dịch ' + (t.note || c?.name)}
        >
          <span
            className={'transaction-icon' + (income ? ' income' : ' expense')}
            style={
              !income && c?.color === '#9690c3'
                ? { color: '#9587bd', background: '#f0ebfb' }
                : {}
            }
          >
            {income ? <ArrowUpRight size={20} /> : <ArrowDownLeft size={20} />}
          </span>
          <span className="transaction-description">
            <strong>{t.note || c?.name || 'Giao dịch'}</strong>
            <small>
              {t.date.slice(8, 10)}/{t.date.slice(5, 7)} · {c?.name}
              {t.attachments.length > 0 && (
                <>
                  <FileText size={10} />
                  {t.attachments.length}
                </>
              )}
            </small>
          </span>
          <span
            className={
              'transaction-amount ' + (income ? 'positive' : 'negative')
            }
          >
            <span>{formatAmount(t.amount, true)} <u>₫</u></span>
            {(t.usd_minor || validRate(usdRate)) && <small className="transaction-usd" title={t.usd_minor ? 'USD gốc · Tỷ giá ' + formatAmount(t.exchange_rate) + ' ₫' : 'Quy đổi theo tỷ giá đang chọn'}>{formatUSD(t.usd_minor || vndToUSD(t.amount, usdRate)!)}</small>}
          </span>
        </button>
      )
    })
  }
  return (
    <>
      <div className="app-shell">
        <div className="app-topbar">
          <div className="brand">
            <div className="app-icon">
              <ArrowUpRight size={25} strokeWidth={2.5} />
            </div>
            <div>
              <h1>Thu Chi & Thuế</h1>
              {state?.settings.demo === 'true' && <p>Dữ liệu mẫu</p>}
            </div>
          </div>
          <div className="topbar-actions">
            <span className="local-indicator">
              <i className="dot" />
              Dữ liệu cục bộ
            </span>
            <Button
              variant="outline"
              className="backup-button"
              onClick={backup}
              disabled={backupBusy}
              aria-label="Tải bản sao lưu (.db)"
            >
              <Download size={15} />
              {backupBusy ? 'Đang xử lý…' : 'Tải bản sao lưu'}
            </Button>
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'} title={theme === 'dark' ? 'Giao diện sáng' : 'Giao diện tối'}>
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSettingsOpen(true)}
              aria-label="Cài đặt"
              title="Cài đặt"
            >
              <Settings size={17} />
            </Button>
          </div>
        </div>
        {loadError ? (
          <div className="connection-error" role="alert">
            <Wallet size={28} />
            <h2>Chưa kết nối được dữ liệu</h2>
            <p>{loadError}</p>
            <Button
              onClick={() => refresh().catch((e) => setLoadError(e.message))}
            >
              Thử lại
            </Button>
          </div>
        ) : !state ? (
          <div className="loading-state">Đang tải dữ liệu…</div>
        ) : (
          <main className="workspace">
            <section
              className="panel entry-panel"
              aria-labelledby="entry-title"
            >
              <header className="panel-header">
                <div>
                  <h2 id="entry-title">Thu Chi</h2>
                </div>

              </header>
              <div className="panel-body entry-body">
                <TransactionForm
                  key={formVersion}
                  categories={state.categories}
                  date={date}
                  onDateChange={setDate}
                  usdRate={usdRate}
                  onRateChange={setUSDRate}
                  onRateSave={saveUSDRate}
                  onSaved={async () => { setRecentYear(Number(date.slice(0, 4))); setRecentMonthNumber(Number(date.slice(5, 7))); setSelectedDay(null); await refreshAll() }}
                  onCategories={() => openCategories()}
                  onNew={() => openCategories(true)}
                  main
                />
                <section
                  className="history-section"
                  aria-labelledby="history-title"
                  aria-keyshortcuts="ArrowLeft ArrowRight"
                  tabIndex={0}
                >
                  <div className="label-row">
                    <h3 id="history-title">Giao dịch gần đây • Tháng {recentMonthNumber}/{recentYear}</h3>
                    <button
                      className="text-button"
                      onClick={() => setHistoryOpen(true)}
                    >
                      Xem tất cả <ArrowRight size={12} />
                    </button>
                  </div>
                  <div className="transactions recent-transactions">
                    {recentRecords.length ? (
                      rows(recentRecords)
                    ) : (
                      <div className="entry-empty">
                        <Inbox size={27} strokeWidth={1.3} />
                        <strong>{records.length ? 'Chưa có giao dịch trong tháng này' : 'Chưa có giao dịch nào'}</strong>
                        <span>{records.length ? 'Chọn tháng khác hoặc ghi thêm giao dịch.' : 'Ghi khoản thu hoặc chi đầu tiên của bạn.'}</span>
                        {!records.length && <button
                          className="text-button"
                          onClick={async () => {
                            setBusy(true)
                            try {
                              await api('/demo', json('POST', {}))
                              await refreshAll()
                              toast.success('Đã nạp dữ liệu mẫu')
                            } catch (e) {
                              toast.error((e as Error).message)
                            } finally {
                              setBusy(false)
                            }
                          }}
                          disabled={busy}
                        >
                          {busy ? 'Đang xử lý…' : 'Khám phá với dữ liệu mẫu'}
                          <ArrowRight size={13} />
                        </button>}
                      </div>
                    )}
                  </div>
                  {selectedDay && <div className="selected-day-label">Ngày {selectedDay.slice(8)}/{selectedDay.slice(5, 7)}/{selectedDay.slice(0, 4)}<button type="button" aria-label="Bỏ chọn ngày" onClick={() => setSelectedDay(null)}><X size={12} /></button></div>}
                  <nav className="recent-pagination" aria-label="Chọn tháng giao dịch gần đây">
                    <div className="recent-months">{recentMonths.map(month => <button key={month} type="button" aria-label={`Tháng ${Number(month.slice(5))} năm ${recentYear}`} title={`Tháng ${Number(month.slice(5))} • ${recentYear}`} aria-current={month === recentMonth ? 'page' : undefined} onClick={() => selectMonth(month)}>T{Number(month.slice(5))}</button>)}</div>
                    <div className="recent-year-actions">
                      {recentYear !== currentYear && <button type="button" className="recent-current" onClick={() => selectRecentYear(currentYear)}>Về hiện tại</button>}
                      <button type="button" aria-label={`Xem năm ${recentYear - 1}`} title={`Năm ${recentYear - 1}`} onClick={() => selectRecentYear(recentYear - 1)}><ChevronLeft size={15} /></button>
                    </div>
                  </nav>
                </section>
              </div>
            </section>
            <section
              className="panel report-panel"
              aria-labelledby="report-title"
            >
              <header className="panel-header">
                <div>
                  <h2 id="report-title">Báo Cáo</h2>
                </div>
                <div className="segmented" role="group" aria-label="Kỳ báo cáo">
                  <button
                    aria-pressed={!annual && !allTime}
                    className={!annual && !allTime ? 'active' : ''}
                    onClick={() => { setAnnual(false); setAllTime(false) }}
                  >
                    Tháng
                  </button>
                  <button
                    aria-pressed={annual && !allTime}
                    className={annual && !allTime ? 'active' : ''}
                    onClick={() => { setAnnual(true); setAllTime(false) }}
                  >
                    Năm
                  </button>
                  <button aria-pressed={allTime} className={allTime ? 'active' : ''} onClick={() => setAllTime(true)}>Tất cả</button>
                </div>
              </header>
              <div className="panel-body report-body">
                {allTime ? <div className="report-all-period">Toàn bộ thời gian</div> : <div className="report-period">
                  <button className="period-arrow" aria-label="Kỳ trước" onClick={() => changePeriod(-1)}><ChevronLeft size={17} /></button>
                  {annual ? <Select label="Chọn kỳ báo cáo" className="report-year-select" value={period.slice(0, 4)} onValueChange={value => setPeriod(value + period.slice(4))}
                    options={Array.from({ length: 101 }, (_, i) => ({ value: String(2000 + i), label: `Năm ${2000 + i}` }))} /> : <label className="period-picker">
                    <span>Tháng {Number(period.slice(5))} <i>·</i> {period.slice(0, 4)} <CalendarDays size={13} /></span>
                    <input aria-label="Chọn kỳ báo cáo" type="month" min="2000-01" max="2100-12" value={period} onChange={e => { if (/^\d{4}-\d{2}$/.test(e.target.value)) setPeriod(e.target.value) }} />
                  </label>}
                  <button className="period-arrow" aria-label="Kỳ sau" onClick={() => changePeriod(1)}><ChevronRight size={17} /></button>
                </div>}
                <div className="profit-card">
                  <div className="metric-label">
                    <h3>{allTime ? 'Tổng lợi nhuận' : 'Lợi nhuận kỳ này'}</h3>
                    <ArrowUpRight size={15} />
                  </div>
                  <Money
                    value={profit}
                    usd={vndToUSD(profit, usdRate)}
                    rate={usdRate}
                    className={
                      profit < 0n ? 'negative profit-value' : 'profit-value'
                    }
                  />
                </div>
                <div
                  className={
                    'metric-grid' +
                    (revenue > 99999999n || expenses > 99999999n
                      ? ' metric-wide'
                      : '')
                  }
                >
                  <div className="metric-card">
                    <div className="metric-label">
                      <h3>Doanh thu</h3>
                      <ArrowUpRight size={14} className="positive" />
                    </div>
                    <Money value={revenue} className="positive" usd={vndToUSD(revenue, usdRate)} rate={usdRate} />
                  </div>
                  <div className="metric-card">
                    <div className="metric-label">
                      <h3>Chi tiêu</h3>
                      <ArrowDownLeft size={14} className="negative" />
                    </div>
                    <Money value={expenses} className="negative" usd={vndToUSD(expenses, usdRate)} rate={usdRate} />
                  </div>
                </div>
                <div className="cashflow-card">
                  <div className="cashflow-heading">
                    <div>
                      <h3>Dòng tiền</h3>
                    </div>
                    <Select label="Cách hiển thị dòng tiền" className="chart-display-select" value={cumulative ? 'cumulative' : 'period'} onValueChange={value => setCumulative(value === 'cumulative')}
                      options={[{ value: 'period', label: allTime ? 'Theo năm' : annual ? 'Theo tháng' : 'Theo ngày' }, { value: 'cumulative', label: 'Lũy kế' }]} />
                  </div>
                  <CashChart
                    transactions={inPeriod}
                    annual={annual}
                    allTime={allTime}
                    period={period}
                    cumulative={cumulative}
                  />
                  <div className="chart-legend">
                    <span>
                      <i className="dot" />
                      Doanh thu
                    </span>
                    <span>
                      <i className="dot" />
                      Chi tiêu
                    </span>
                  </div>
                </div>
                {!allTime && <DailyActivity year={currentYear} transactions={records} selectedDay={selectedDay} onSelect={selectActivityDay} />}
              </div>
            </section>
            <TaxPanel
              tax={tax}
              year={year}
              onYear={setYear}
              refresh={refreshAll}
              onSettings={() => setSettingsOpen(true)}
            />
          </main>
        )}
      </div>
      <Modal
        open={categoryOpen}
        onOpenChange={setCategoryOpen}
        title="Quản lý danh mục"
        description="Sắp xếp các khoản thu và chi theo cách của bạn."
      >
        {state && (
          <CategoryManager
            key={categoryNew ? 'new' : 'manage'}
            categories={state.categories}
            refresh={refresh}
            startNew={categoryNew}
          />
        )}
      </Modal>
      <Modal
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        title="Tất cả giao dịch"
        description={
          records.length + ' giao dịch được lưu cục bộ trên máy của bạn.'
        }
        wide
      >
        <div className="history-filters">
          <input
            aria-label="Tìm giao dịch"
            placeholder="Tìm nội dung, danh mục…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select label="Lọc danh mục" value={categoryFilter} onValueChange={setCategoryFilter}
            options={[{ value: 'all', label: 'Tất cả danh mục' }, ...(state?.categories.map(c => ({ value: String(c.id), label: c.name })) || [])]} />
          <Select label="Lọc loại giao dịch" value={kindFilter} onValueChange={setKindFilter}
            options={[{ value: 'all', label: 'Thu và chi' }, { value: 'income', label: 'Khoản thu' }, { value: 'expense', label: 'Khoản chi' }]} />
          <label className="form-field">
            Từ ngày
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="form-field">
            Đến ngày
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <Button
            variant="ghost"
            onClick={() => {
              setSearch('')
              setCategoryFilter('all')
              setKindFilter('all')
              setFrom('')
              setTo('')
            }}
          >
            <X size={13} />
            Xóa bộ lọc
          </Button>
        </div>
        <div className="all-transactions">
          {filtered.length ? (
            rows(filtered)
          ) : (
            <p className="empty-message">Không có giao dịch phù hợp.</p>
          )}
        </div>
      </Modal>
      <Modal
        open={!!editing}
        onOpenChange={(v) => !v && setEditing(null)}
        title="Chi tiết giao dịch"
        description="Cập nhật nội dung và chứng từ của giao dịch."
      >
        {editing && state && (
          <>
            <TransactionForm
              key={editing.id}
              transaction={editing}
              categories={state.categories}
              date={editDate}
              onDateChange={setEditDate}
              usdRate={usdRate}
              onRateChange={setUSDRate}
              onRateSave={saveUSDRate}
              onSaved={async () => {
                await refreshAll()
                setEditing(null)
              }}
              onCategories={() => openCategories()}
              onNew={() => openCategories(true)}
              main
            />
            <Button
              variant="ghost"
              className="delete-transaction"
              onClick={() => setDeleting(editing)}
            >
              Xóa giao dịch
            </Button>
          </>
        )}
      </Modal>
      <Confirm
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="Xóa giao dịch?"
        description="Giao dịch sẽ được loại khỏi báo cáo. Dữ liệu gốc vẫn được giữ trong lịch sử."
        action="Xác nhận xóa"
        busy={busy}
        onConfirm={async () => {
          setBusy(true)
          try {
            await api('/transactions/' + deleting?.id, { method: 'DELETE' })
            await refreshAll()
            setDeleting(null)
            setEditing(null)
            toast.success('Đã xóa giao dịch')
          } catch (e) {
            toast.error((e as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      />
      <Modal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title="Cài đặt"
        description="Dữ liệu được lưu bằng SQLite trên máy của bạn. Bản sao chỉ được gửi lên Google Drive khi bạn chủ động sao lưu."
      >
        <AccessSettings />
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            try {
              await api(
                '/settings',
                json('PUT', {
                  share_bps: String(Math.round(Number(share) * 100)),
                  tax_confirmed: String(confirmed),
                }),
              )
              await refreshAll()
              setSettingsOpen(false)
              toast.success('Đã lưu cài đặt')
            } catch (e) {
              toast.error((e as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          <label className="form-field">
            Tỷ lệ lợi nhuận của bạn (%)
            <NumberInput
              min={0}
              max={100}
              decimals={2}
              value={share}
              onValueChange={setShare}
              required
            />
          </label>
          <p className="fine muted">
            Phần cộng sự: {Number((100 - Number(share)).toFixed(2))}%. Chia lợi
            nhuận sau khi trừ thuế đã chọn.
          </p>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Tôi đã kiểm tra ngành nghề nội dung số, điều kiện cư trú, cơ sở
            doanh thu tính thuế, chi phí hợp lệ và điều kiện ưu đãi.
          </label>
          <p className="notice">
            Doanh thu báo cáo là tiền thực nhận. Không tự quy đổi Steam gross
            thành doanh thu tính thuế. Thuế GTGT cần đối chiếu riêng. Nguồn luật
            tham khảo cần được xác minh trước khi chốt.
          </p>
          <Button disabled={busy}>
            {busy ? 'Đang xử lý…' : 'Lưu cài đặt'}
          </Button>
        </form>
        <div className="settings-backup">
          <h3>Sao lưu và khôi phục</h3>
          <p className="fine muted">
            Bản sao lưu .db bao gồm giao dịch, danh mục, quy tắc thuế và tất cả
            chứng từ. Tệp khôi phục tối đa 50 MB.
          </p>
          <div className="backup-actions">
            <Button variant="outline" onClick={backup} disabled={backupBusy}>
              <Download size={15} />
              Tải bản sao lưu (.db)
            </Button>
            <Button
              variant="outline"
              onClick={() => restoreInput.current?.click()}
            >
              <Upload size={15} />
              Khôi phục
            </Button>
          </div>
          <input
            ref={restoreInput}
            type="file"
            accept=".db"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) {
                if (file.size > 50 * 1024 * 1024)
                  toast.error('Bản sao lưu tối đa 50 MB')
                else setRestoring(file)
              }
              e.target.value = ''
            }}
          />
        </div>
        <DriveBackup />
        <div className="settings-danger">
          <h3>Xóa dữ liệu</h3>
          <Button variant="destructive" disabled={busy || resetBusy} onClick={() => { setResetPassword(''); setResetError(''); setResetOpen(true) }}><Trash2 size={15} />Xóa toàn bộ dữ liệu</Button>
        </div>
      </Modal>
      <Modal open={resetOpen} onOpenChange={open => { if (!resetBusy) { setResetOpen(open); setResetPassword(''); setResetError('') } }} title="Xóa toàn bộ dữ liệu?" description="Xóa vĩnh viễn giao dịch, chứng từ, danh mục tùy chỉnh, quy tắc thuế, báo cáo đã chốt và lịch sử. Ứng dụng trở về mặc định. Các bản sao lưu tự động trong ứng dụng cũng bị xóa; bản sao lưu đã tải về vẫn được giữ.">
        <form className="stack" onSubmit={async e => {
          e.preventDefault()
          if (!resetPassword || resetBusy) return
          setResetBusy(true); setResetError('')
          try {
            await api('/settings/reset', json('POST', { password: resetPassword }))
            setResetPassword(''); setFormVersion(v => v + 1); selectRecentYear(currentYear)
            setEditing(null); setHistoryOpen(false); setCategoryOpen(false)
            setSearch(''); setFrom(''); setTo(''); setCategoryFilter('all'); setKindFilter('all')
            setDate(today()); setPeriod(today().slice(0, 7)); setAnnual(false); setAllTime(false); setCumulative(false)
            await refreshAll()
            setResetOpen(false); setSettingsOpen(false)
            toast.success('Đã xóa toàn bộ dữ liệu')
          } catch (e) { setResetError((e as Error).message) } finally { setResetBusy(false) }
        }}>
          <p className="reset-confirmation-hint">Nhập <code>TOILACONCHOCUNCUNGGAUGAU</code> để xác nhận.</p>
          <label className="form-field">Mật khẩu xác nhận<input type="text" spellCheck={false} autoCapitalize="none" autoComplete="off" value={resetPassword} onChange={e => { setResetPassword(e.target.value); setResetError('') }} required disabled={resetBusy} aria-invalid={!!resetError} aria-describedby="reset-error" /></label>
          {resetError && <p id="reset-error" className="field-error" role="alert">{resetError}</p>}
          <div className="dialog-actions"><Button type="button" variant="outline" disabled={resetBusy} onClick={() => { setResetOpen(false); setResetPassword(''); setResetError('') }}>Hủy</Button><Button type="submit" variant="destructive" disabled={!resetPassword || resetBusy}>{resetBusy ? 'Đang xử lý…' : 'Xác nhận xóa toàn bộ'}</Button></div>
        </form>
      </Modal>
      <Confirm
        open={!!restoring}
        onOpenChange={(v) => !v && setRestoring(null)}
        title="Khôi phục bản sao lưu?"
        description={
          'Dữ liệu từ “' +
          restoring?.name +
          '” sẽ thay thế dữ liệu hiện tại. Ứng dụng tự giữ một bản sao của dữ liệu hiện tại trước khi khôi phục.'
        }
        action="Xác nhận khôi phục"
        busy={busy}
        onConfirm={async () => {
          if (!restoring) return
          setBusy(true)
          try {
            const body = new FormData()
            body.append('backup', restoring)
            await api('/restore', { method: 'POST', body })
            selectRecentYear(currentYear)
            await refreshAll()
            setRestoring(null)
            setSettingsOpen(false)
            toast.success('Đã khôi phục dữ liệu và chứng từ')
          } catch (e) {
            toast.error((e as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      />
      <Toaster position="bottom-right" richColors closeButton duration={4000} />
    </>
  )
}
