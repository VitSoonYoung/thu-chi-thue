import { NumberInput } from './NumberInput'
import { useState, type ReactNode } from 'react'
import {
  ArrowUpRight,
  BookOpen,
  Settings2,
  Waves,
  ExternalLink,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  api,
  formatAmount,
  json,
  type Method,
  type Rule,
  type Tax,
} from '../lib'
import { Button } from './ui/button'
import { Modal } from './ui/modal'
import { Confirm } from './ui/confirm'
import { Select } from './ui/select'
function Money({
  value,
  className = '',
}: {
  value: string
  className?: string
}) {
  return (
    <span className={'money ' + className}>
      {formatAmount(value)}
      <span className="currency">₫</span>
    </span>
  )
}
function yearEligible(year: number) { return year === 2026 || year === 2027 }

function TaxCard({
  method,
  primary,
  tax,
}: {
  method: Method
  primary?: boolean
  tax: Tax
}) {
  const rate = method.rate / 100
  const exempt = !!tax.rule && BigInt(tax.revenue) <= BigInt(tax.rule.threshold)
  return (
    <div className={'tax-method' + (primary ? ' tax-primary' : '')}>
      <div className="tax-method-heading">
        <span className={'method-icon' + (primary ? ' positive' : '')}>
          {primary ? <ArrowUpRight size={19} /> : <Waves size={17} />}
        </span>
        <h3>{primary ? 'Theo doanh thu' : 'Theo lợi nhuận'}</h3>
        <span
          className={
            'badge' + (method.applicable && primary ? ' badge-green' : '')
          }
        >
          {!tax.rule
            ? 'Chưa có quy tắc'
            : !method.applicable
              ? 'Không áp dụng'
              : BigInt(tax.revenue) <= BigInt(tax.rule.threshold)
                ? 'Trong ngưỡng miễn thuế'
                : tax.confirmed
                  ? 'Có thể chọn*'
                  : 'Cần xác minh'}
        </span>
      </div>
      <p className={'tax-basis' + (primary ? ' tax-revenue' : '')}>
        {primary
          ? 'Doanh thu năm'
          : 'Chi phí được trừ'}{' '}
        <span>{formatAmount(primary ? tax.revenue : tax.deductible)} ₫</span>
      </p>
      {tax.rule && (
        <div className="tax-formula">
          <span>Công thức tính</span>
          <p>{primary ? '(Doanh thu năm − ngưỡng miễn thuế)' : '(Doanh thu năm − chi phí được trừ)'} × {rate}%</p>
          {exempt ? (
            <small>Doanh thu chưa vượt {formatAmount(BigInt(tax.rule.threshold))} ₫ nên thuế bằng 0.</small>
          ) : <small>Cơ sở tính tối thiểu bằng 0. {tax.rule.relief_bps > 0 && (yearEligible(tax.year)) && <>Giảm thêm {tax.rule.relief_bps / 100}% nếu doanh thu không vượt {formatAmount(BigInt(tax.rule.relief_limit))} ₫.</>}</small>}
        </div>
      )}
      {tax.rule && method.applicable ? (
        <>
          <Money
            value={method.total}
            className={primary ? 'positive tax-value' : 'tax-value'}
          />
          <div className="tax-calculation">
            <span>{formatAmount(method.base)} ₫ × {rate}%{BigInt(method.reduction) > 0 && <> − {formatAmount(method.reduction)} ₫ ưu đãi</>}</span>
            <small>{tax.locked ? 'Thuế đã chốt' : 'Thuế ước tính'}</small>
          </div>
        </>
      ) : (
        <p className="unavailable">
          {method.reason || 'Cần thêm quy tắc cho năm này'}
        </p>
      )}
      {method.reason && method.applicable && !exempt && (
        <p className="method-reason">{method.reason}</p>
      )}
    </div>
  )
}
export function TaxPanel({
  tax,
  year,
  onYear,
  refresh,
  onSettings,
}: {
  tax: Tax | null
  year: number
  onYear: (v: number) => void
  refresh: () => Promise<void>
  onSettings: () => void
}) {
  const [ruleOpen, setRuleOpen] = useState(false)
  const [draft, setDraft] = useState<Rule | null>(null)
  const [preview, setPreview] = useState<{ before: Tax; after: Tax } | null>(
    null,
  )
  const [confirm, setConfirm] = useState(false)
  const [lock, setLock] = useState(false)
  const [method, setMethod] = useState('revenue')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState(false)
  const missing = !tax?.rule
  function editRules() {
    setDraft(
      tax?.rule
        ? { ...tax.rule, reason: '' }
        : {
            year,
            version: 0,
            threshold: 1000000000,
            choice_limit: 3000000000,
            middle_limit: 50000000000,
            relief_limit: 10000000000,
            revenue_bps: 500,
            low_bps: 1500,
            middle_bps: 1700,
            high_bps: 2000,
            relief_bps: 0,
            effective_from: `${year}-01-01`,
            verified_at: '',
            status: 'reference',
            reason: '',
            sources: [],
          },
    )
    setPreview(null)
    setError('')
    setSourcesOpen(false)
    setRuleOpen(true)
  }
  const [sourcesOpen, setSourcesOpen] = useState(false)
  function field(key: keyof Rule, label: string, percent = false, hint?: ReactNode) {
    if (!draft) return null
    return <label className="form-field" key={key}>
      <span>{label}</span>
      <NumberInput aria-label={label} min={0} max={percent ? 100 : Number.MAX_SAFE_INTEGER} decimals={percent ? 2 : 0}
        value={Number(draft[key]) / (percent ? 100 : 1)}
        onValueChange={value => {
          setPreview(null)
          setDraft({ ...draft, [key]: Math.round(Number(value) * (percent ? 100 : 1)) })
        }} required />
      {hint && <small className="rule-hint">{hint}</small>}
    </label>
  }
  const thresholdRemaining = draft && tax ? BigInt(draft.threshold) - BigInt(tax.revenue) : 0n
  const draftValid = draft && draft.choice_limit >= draft.threshold && draft.middle_limit >= draft.choice_limit
  return (
    <section className="panel tax-panel" aria-labelledby="tax-title">
      <header className="panel-header">
        <div>
          <h2 id="tax-title">Thuế</h2>
        </div>
        <Select label="Năm tính thuế" value={String(year)} onValueChange={value => onYear(Number(value))}
          className="tax-year-select"
          options={Array.from({ length: 101 }, (_, i) => ({ value: String(2000 + i), label: `Năm ${2000 + i}` }))} />
      </header>
      <div className="panel-body tax-body">
        {tax ? (
          <>
            <TaxCard method={tax.revenue_method} primary tax={tax} />
            <TaxCard method={tax.profit_method} tax={tax} />
            <div className="legal-card">
              <button
                className="legal-heading"
                onClick={() => setDetail(!detail)}
                aria-expanded={detail}
              >
                <BookOpen size={13} />
                <strong>Căn cứ pháp lý</strong>
                <ExternalLink size={13} />
              </button>
              {detail && (
                <div className="legal-detail">
                  {tax.rule?.sources.length ? tax.rule.sources.map((source) => (
                    <a key={source.url} href={source.url} title={source.url} target="_blank" rel="noreferrer">
                      {source.title}{source.number ? ` ${source.number}` : ''}
                    </a>
                  )) : <p>Chưa có nguồn pháp lý.</p>}
                </div>
              )}
            </div>
            <div className="tax-footer">
              <div>
                <button className="text-button" onClick={editRules}>
                  <Settings2 size={12} />
                  {missing ? 'Thêm quy tắc' : 'Quy tắc thuế'}
                </button>
                <button
                  className="text-button"
                  onClick={() => setLock(true)}
                  disabled={missing || tax.locked}
                >
                  {tax.locked ? 'Đã chốt báo cáo' : 'Chọn phương pháp'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <p className="muted">Đang tải dữ liệu thuế…</p>
        )}
      </div>
      <Modal
        open={ruleOpen}
        onOpenChange={setRuleOpen}
        title={'Quy tắc thuế năm ' + year}
        description="Điều chỉnh thông số, xem trước số thuế rồi áp dụng. Báo cáo đã chốt giữ nguyên."
        wide
      >
        {draft && (
          <form
            className="stack rule-editor"
            onSubmit={async (e) => {
              e.preventDefault()
              setBusy(true)
              setError('')
              try {
                const p = await api<{ before: Tax; after: Tax }>(
                  '/tax/' + year + '/preview',
                  json('POST', draft),
                )
                setPreview(p)
              } catch (e) {
                setError((e as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            <section className="rule-section rule-exemption">
              <div className="rule-section-heading"><h3>Ngưỡng miễn thuế</h3><span>Áp dụng cho cả hai cách tính</span></div>
              {field('threshold', 'Ngưỡng miễn thuế (VND)')}
              {tax && <p className="rule-context">Doanh thu năm: <strong>{formatAmount(tax.revenue)} ₫</strong>. {thresholdRemaining >= 0n
                ? <>Còn {formatAmount(thresholdRemaining)} ₫ đến ngưỡng miễn thuế.</>
                : <>Đã vượt ngưỡng {formatAmount(-thresholdRemaining)} ₫.</>}</p>}
            </section>
            <section className="rule-section">
              <div className="rule-section-heading"><h3>Theo doanh thu</h3><span>Trừ ngưỡng rồi nhân tỷ lệ</span></div>
              <div className="rule-grid">
                {field('choice_limit', 'Giới hạn chọn phương pháp doanh thu', false, 'Doanh thu cao hơn mức này dùng cách tính lợi nhuận.')}
                {field('revenue_bps', 'Tỷ lệ trên doanh thu (%)', true)}
              </div>
              <p className="rule-equation">Cơ sở tính = doanh thu − {formatAmount(BigInt(draft.threshold))} ₫, tối thiểu 0. Thuế = cơ sở tính × {draft.revenue_bps / 100}%</p>
            </section>
            <section className="rule-section">
              <div className="rule-section-heading"><h3>Theo lợi nhuận</h3><span>Chọn thuế suất theo doanh thu năm</span></div>
              <p className="rule-equation">Lợi nhuận tính thuế = doanh thu − chi phí được trừ, tối thiểu bằng 0.</p>
              <div className="rule-tiers">
                <div><span>Doanh thu đến {formatAmount(BigInt(draft.choice_limit))} ₫</span>{field('low_bps', 'Thuế suất lợi nhuận bậc đầu (%)', true)}</div>
                <div><span>Trên {formatAmount(BigInt(draft.choice_limit))} ₫ đến mức dưới đây</span>{field('middle_bps', 'Thuế suất lợi nhuận bậc giữa (%)', true)}</div>
              </div>
              {field('middle_limit', 'Giới hạn bậc thuế giữa')}
              <div className="rule-tiers"><div><span>Doanh thu trên {formatAmount(BigInt(draft.middle_limit))} ₫</span>{field('high_bps', 'Thuế suất lợi nhuận bậc cuối (%)', true)}</div></div>
              <p className="rule-equation">Thuế = lợi nhuận tính thuế × thuế suất. Miễn thuế nếu doanh thu trong ngưỡng.</p>
            </section>
            <section className="rule-section">
              <div className="rule-section-heading"><h3>Ưu đãi thuế</h3><span>{yearEligible(year) ? 'Áp dụng khi đủ điều kiện' : 'Năm này không áp dụng ưu đãi'}</span></div>
              {yearEligible(year) ? <div className="rule-grid">
                {field('relief_limit', 'Giới hạn doanh thu được ưu đãi')}
                {field('relief_bps', 'Giảm thuế khi đủ điều kiện (%)', true)}
              </div> : <p className="rule-hint">Ưu đãi hiện chỉ hỗ trợ năm 2026 và 2027.</p>}
              {yearEligible(year) && <p className="rule-equation">Thuế sau ưu đãi = thuế ban đầu × (100% − {draft.relief_bps / 100}%).</p>}
            </section>
            {!draftValid && <p className="field-error" role="alert">Giới hạn chọn phương pháp phải từ ngưỡng miễn thuế trở lên; giới hạn bậc giữa phải từ giới hạn chọn phương pháp trở lên.</p>}
            <details className="rule-sources" open={sourcesOpen || !draft.sources.length} onToggle={e => setSourcesOpen(e.currentTarget.open)}>
              <summary><BookOpen size={15} /><span>Nguồn pháp lý</span><small>{draft.sources.length} văn bản</small></summary>
              <div className="stack legal-editor" onInvalidCapture={() => setSourcesOpen(true)}>
              {draft.sources.map((source, i) => (
                <fieldset className="source-editor" key={i}>
                  <legend>Văn bản {i + 1}</legend>
                  {(
                    [
                      { key: 'title', label: 'Tên văn bản' },
                      { key: 'url', label: 'Liên kết' },
                    ] as const
                  ).map((field) => (
                    <label className="form-field" key={field.key}>
                      {field.label}
                      <input
                        required
                        type={field.key === 'url' ? 'url' : 'text'}
                        value={source[field.key]}
                        onChange={(e) => {
                          setPreview(null)
                          setDraft({
                            ...draft,
                            sources: draft.sources.map((s, index) =>
                              index === i
                                ? { ...s, [field.key]: e.target.value }
                                : s,
                            ),
                          })
                        }}
                      />
                    </label>
                  ))}
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setPreview(null)
                      setDraft({
                        ...draft,
                        sources: draft.sources.filter(
                          (_, index) => index !== i,
                        ),
                      })
                    }}
                  >
                    Gỡ nguồn
                  </Button>
                </fieldset>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setPreview(null)
                  setDraft({
                    ...draft,
                    sources: [
                      ...draft.sources,
                      {
                        title: '',
                        number: '',
                        url: '',
                        effective_from: '',
                        verified_at: '',
                        status: 'reference',
                      },
                    ],
                  })
                }}
              >
                Thêm nguồn pháp lý
              </Button>

              </div>
            </details>
            <label className="form-field">
              Lý do thay đổi
              <input
                type="text"
                placeholder="Ví dụ: Cập nhật tỷ lệ theo văn bản mới"
                required
                minLength={5}
                value={draft.reason}
                onChange={(e) => {
                  setPreview(null)
                  setDraft({ ...draft, reason: e.target.value })
                }}
              />
            </label>
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            {preview && (
              <div className="preview-table">
                <h3>Ảnh hưởng của quy tắc mới</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Chỉ tiêu</th>
                      <th>Hiện tại</th>
                      <th>Bản nháp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(['revenue_method', 'profit_method'] as const).map(
                      (key) => (
                        <tr key={key}>
                          <th>
                            {key === 'revenue_method'
                              ? 'Thuế theo doanh thu'
                              : 'Thuế theo lợi nhuận'}
                          </th>
                          <td>
                            {preview.before[key].applicable
                              ? formatAmount(preview.before[key].total) + ' ₫'
                              : 'Không áp dụng'}
                          </td>
                          <td>
                            {preview.after[key].applicable
                              ? formatAmount(preview.after[key].total) + ' ₫'
                              : 'Không áp dụng'}
                          </td>
                        </tr>
                      ),
                    )}
                    <tr>
                      <th>Lợi nhuận sau thuế theo lợi nhuận</th>
                      <td>
                        {formatAmount(
                          preview.before.profit_method.after_tax || '0',
                        )}{' '}
                        ₫
                      </td>
                      <td>
                        {formatAmount(
                          preview.after.profit_method.after_tax || '0',
                        )}{' '}
                        ₫
                      </td>
                    </tr>
                    <tr>
                      <th>Phần của bạn</th>
                      <td>
                        {formatAmount(
                          preview.before.profit_method.your_share || '0',
                        )}{' '}
                        ₫
                      </td>
                      <td>
                        {formatAmount(
                          preview.after.profit_method.your_share || '0',
                        )}{' '}
                        ₫
                      </td>
                    </tr>
                    <tr>
                      <th>Phần cộng sự</th>
                      <td>
                        {formatAmount(
                          preview.before.profit_method.partner_share || '0',
                        )}{' '}
                        ₫
                      </td>
                      <td>
                        {formatAmount(
                          preview.after.profit_method.partner_share || '0',
                        )}{' '}
                        ₫
                      </td>
                    </tr>
                    <tr>
                      <th>Chênh lệch thuế theo lợi nhuận</th>
                      <td colSpan={2}>
                        {formatAmount(
                          BigInt(preview.after.profit_method.total || '0') -
                            BigInt(preview.before.profit_method.total || '0'),
                          true,
                        )}{' '}
                        ₫
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <div className="dialog-actions">
              <Button type="submit" variant="outline" disabled={busy || !draftValid}>
                {busy ? 'Đang xử lý…' : 'Xem trước'}
              </Button>
              <Button
                type="button"
                disabled={!preview || busy}
                onClick={() => setConfirm(true)}
              >
                Áp dụng phiên bản mới
              </Button>
            </div>
          </form>
        )}
      </Modal>
      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        title={'Áp dụng công thức mới cho năm ' + year + '?'}
        description="Quy tắc mới sẽ được lưu cùng lịch sử thay đổi. Báo cáo đã chốt giữ nguyên phiên bản cũ."
        action="Xác nhận áp dụng"
        busy={busy}
        onConfirm={async () => {
          setBusy(true)
          try {
            await api('/tax/' + year + '/rules', json('POST', draft))
            await refresh()
            setConfirm(false)
            setRuleOpen(false)
            toast.success('Đã lưu phiên bản quy tắc mới')
          } catch (e) {
            toast.error((e as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      />
      <Modal
        open={lock}
        onOpenChange={setLock}
        title={'Chốt thuế năm ' + year}
        description="Sau khi chốt, kết quả được giữ nguyên kể cả khi giao dịch hoặc quy tắc thay đổi."
      >
        {tax && (
          <div className="stack">
            {!tax.confirmed ? (
              <>
                <p className="notice">
                  Cần xác nhận ngành nghề, cư trú, doanh thu tính thuế và chi
                  phí hợp lệ trước khi chọn phương pháp.
                </p>
                <Button
                  onClick={() => {
                    setLock(false)
                    onSettings()
                  }}
                >
                  Mở cài đặt xác nhận
                </Button>
              </>
            ) : (
              <>
                <label className="form-field">
                  Phương pháp
                  <Select label="Phương pháp" value={method} onValueChange={setMethod} options={[
                    { value: 'revenue', label: 'Theo doanh thu', disabled: !tax.revenue_method.applicable },
                    { value: 'profit', label: 'Theo lợi nhuận', disabled: !tax.profit_method.applicable },
                  ]} />
                </label>
                <div className="summary-box">
                  <p>
                    Thuế TNCN:{' '}
                    <strong>
                      {formatAmount(
                        tax[
                          method === 'revenue'
                            ? 'revenue_method'
                            : 'profit_method'
                        ].total,
                      )}{' '}
                      ₫
                    </strong>
                  </p>
                  <p>
                    Phần của bạn:{' '}
                    <strong>
                      {formatAmount(
                        tax[
                          method === 'revenue'
                            ? 'revenue_method'
                            : 'profit_method'
                        ].your_share,
                      )}{' '}
                      ₫
                    </strong>
                  </p>
                  <p>
                    Phần cộng sự:{' '}
                    <strong>
                      {formatAmount(
                        tax[
                          method === 'revenue'
                            ? 'revenue_method'
                            : 'profit_method'
                        ].partner_share,
                      )}{' '}
                      ₫
                    </strong>
                  </p>
                </div>
                <Button
                  disabled={
                    busy ||
                    (method === 'revenue' && !tax.revenue_method.applicable)
                  }
                  onClick={async () => {
                    setBusy(true)
                    try {
                      await api(
                        '/tax/' + year + '/lock',
                        json('POST', { method }),
                      )
                      await refresh()
                      setLock(false)
                      toast.success('Đã chốt báo cáo thuế')
                    } catch (e) {
                      toast.error((e as Error).message)
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  {busy ? 'Đang xử lý…' : 'Xác nhận và chốt báo cáo'}
                </Button>
              </>
            )}
          </div>
        )}
      </Modal>
    </section>
  )
}
