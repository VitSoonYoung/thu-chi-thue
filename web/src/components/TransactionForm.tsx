import { Select } from './ui/select'
import { useEffect, useRef, useState } from 'react'
import { FileText, Paperclip, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, type Category, type Transaction } from '../lib'
import { AmountInput } from './AmountInput'
import { Button } from './ui/button'
import { NumberInput } from './NumberInput'
import { usdToVND } from '../forex'
import { createRequestId } from '../requestId'
export function TransactionForm({
  categories,
  date,
  onDateChange,
  usdRate,
  onRateChange,
  onRateSave,
  transaction,
  onSaved,
  onCategories,
  onNew,
  main = false,
}: {
  categories: Category[]
  date: string
  usdRate: string
  onRateChange: (rate: string) => void
  onRateSave: (rate: string) => Promise<void>
  onDateChange: (date: string) => void
  transaction?: Transaction
  onSaved: () => Promise<void>
  onCategories: () => void
  onNew: () => void
  main?: boolean
}) {
  const [amount, setAmount] = useState<bigint | null>(
    transaction ? BigInt(transaction.amount) : null,
  )
  const [hasAmountText, setHasAmountText] = useState(!!transaction?.amount)
  const expanded = !main || !!transaction || hasAmountText
  const [usdMinor, setUSDMinor] = useState(transaction?.usd_minor || '')
  const [rate, setRate] = useState(transaction?.exchange_rate || usdRate)
  const rateChanged = useRef(false)
  useEffect(() => { if (!transaction) setRate(usdRate) }, [usdRate, transaction])
  const [category, setCategory] = useState(
    transaction?.category_id ||
      categories.find((c) => c.kind !== 'expense')?.id ||
      0,
  )
  const [note, setNote] = useState(transaction?.note || '')
  const [deductible, setDeductible] = useState(transaction?.deductible || false)
  const [files, setFiles] = useState<File[]>([])
  const [removed, setRemoved] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [key, setKey] = useState(0)
  const [requestId, setRequestId] = useState(createRequestId)
  const [error, setError] = useState('')
  const amountRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const saving = useRef(false)
  const allowed = categories.filter(
    (c) =>
      !amount || c.kind === 'both' ||
      c.kind === (amount !== null && amount < 0n ? 'expense' : 'income'),
  )
  const selected = allowed.some((c) => c.id === category)
    ? category
    : allowed[0]?.id || 0
  const attached =
    transaction?.attachments.filter((f) => !removed.includes(f.id)) || []
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const savedAmount = usdMinor ? usdToVND(BigInt(usdMinor), rate) : amount
    if (!savedAmount || !selected || saving.current) return
    saving.current = true
    setBusy(true)
    setError('')
    try {
      const body = new FormData()
      body.append(
        'data',
        JSON.stringify({
          amount: savedAmount.toString(),
          usd_minor: usdMinor,
          exchange_rate: usdMinor ? rate : '', 
          category_id: selected,
          date,
          note,
          deductible,
          request_id: requestId,
          remove: removed,
        }),
      )
      files.forEach((file) => body.append('files', file))
      await api('/transactions' + (transaction ? '/' + transaction.id : ''), {
        method: transaction ? 'PUT' : 'POST',
        body,
      })
      await onSaved()
      toast.success(transaction ? 'Đã cập nhật giao dịch' : 'Đã ghi giao dịch')
      if (!transaction) {
        setAmount(null)
        setHasAmountText(false)
        setUSDMinor('')
        setNote('')
        setDeductible(false)
        setFiles([])
        setRequestId(createRequestId())
        setKey((k) => k + 1)
        requestAnimationFrame(() => amountRef.current?.focus())
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  return (
    <form className={'transaction-form' + (expanded ? ' is-expanded' : ' is-collapsed')} onSubmit={save}>
      <AmountInput
        inputId={transaction ? 'edit-amount' : 'amount'}
        key={key}
        ref={amountRef}
        initial={transaction?.amount}
        initialUSD={transaction?.usd_minor}
        rate={rate}
        onUSDChange={setUSDMinor}
        rateControl={<label className="usd-rate-field"><span>Tỷ giá $</span><NumberInput aria-label="Tỷ giá USD" min={1} max={1000000000} value={rate === '0' ? '' : rate} placeholder="0" onValueChange={value => { setRate(value); rateChanged.current = true; onRateChange(value) }} onBlur={() => { if (rateChanged.current) { rateChanged.current = false; onRateSave(rate).catch(e => toast.error(e.message)) } }} /><span>₫</span></label>}
        onValue={setAmount}
        collapsed={!expanded}
        clearable={main && !transaction}
        disabled={busy}
        onTextChange={text => { setHasAmountText(text.trim().length > 0); if (!text.trim()) setError('') }}
      />
      <div className="transaction-add-details" hidden={!expanded}>
      <div className="note-attachment-row">
      <div className="note-field">
        <label className="sr-only" htmlFor={transaction ? 'edit-note' : 'note'}>Nội dung</label>
        <input
          id={transaction ? 'edit-note' : 'note'}
          className="note-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={2000}
          placeholder="Nội dung…"
        />
      </div>
      <div className="attachments">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          multiple
          hidden
          onChange={(e) => {
            const selected = Array.from(e.target.files || [])
            if (files.length + attached.length + selected.length > 5) {
              toast.error('Đính kèm tối đa 5 tệp')
              e.target.value = ''
              return
            }
            if (
              selected.some(
                (f) =>
                  !['application/pdf', 'image/jpeg', 'image/png'].includes(
                    f.type,
                  ) ||
                  f.size > 10 * 1024 * 1024 ||
                  f.size === 0,
              )
            ) {
              toast.error('Chọn PDF, JPG, PNG, tối đa 10 MB mỗi tệp')
              e.target.value = ''
              return
            }
            setFiles([...files, ...selected])
            e.target.value = ''
          }}
        />
        <button
          type="button"
          className="attachment-control"
          aria-label={`Đính kèm${files.length + attached.length ? ` (${files.length + attached.length})` : ''}`}
          onClick={() => fileRef.current?.click()}
        >
          <Paperclip size={14} strokeWidth={1.6} />
          <strong>Đính kèm</strong>
          {files.length + attached.length > 0 && <span className="attachment-count" aria-hidden="true">{files.length + attached.length}</span>}
        </button>
        {attached.map((file) => (
          <div className="attachment-file" key={file.id}>
            <FileText size={12} />
            <a href={'/api/attachments/' + file.id}>{file.name}</a>
            <button
              type="button"
              aria-label={'Gỡ ' + file.name}
              onClick={() => setRemoved([...removed, file.id])}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        {files.map((file, i) => (
          <div className="attachment-file" key={i}>
            <FileText size={12} />
            <span title={file.name}>{file.name}</span>
            <small>{Math.ceil(file.size / 1024)} KB</small>
            <button
              type="button"
              aria-label={'Gỡ ' + file.name}
              onClick={() => setFiles(files.filter((_, index) => index !== i))}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      </div>
      <div className="transaction-details-row">
        <label className="transaction-date"><span className="sr-only">Ngày giao dịch</span><input type="date" name="date" aria-label="Ngày giao dịch" required value={date} onChange={e => e.target.value && onDateChange(e.target.value)} /></label>
        <label className="transaction-category"><span className="sr-only">Danh mục</span>
          <Select label="Danh mục" value={String(selected)} onValueChange={value => setCategory(Number(value))}
            options={[...(!categories.length ? [{ value: '0', label: 'Chọn danh mục' }] : []), ...categories.map(c => ({ value: String(c.id), label: c.name, disabled: !allowed.some(a => a.id === c.id) })), { value: '__new__', label: '＋ Mới', action: onNew }]} />
        </label>
      </div>
      {amount !== null && amount < 0n && (
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={deductible}
            onChange={(e) => setDeductible(e.target.checked)}
          />
          Chi phí đủ điều kiện được trừ khi tính thuế
        </label>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <Button
        type="submit"
        className="save-transaction"
        disabled={busy || !amount || !selected}
      >
        <Plus size={16} />
        {busy ? 'Đang xử lý…' : transaction ? 'Lưu thay đổi' : 'Ghi giao dịch'}
      </Button>
      </div>
    </form>
  )
}
