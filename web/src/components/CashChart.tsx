import { Area, AreaChart, CartesianGrid, Tooltip, XAxis } from 'recharts'
import { formatAmount, type Transaction } from '../lib'
import { ChartNoAxesCombined } from 'lucide-react'
import { ChartContainer } from './ui/chart'
export function CashChart({
  transactions,
  period,
  annual,
  allTime = false,
  cumulative,
}: {
  transactions: Transaction[]
  period: string
  annual: boolean
  allTime?: boolean
  cumulative: boolean
}) {
  const [year, month] = period.split('-').map(Number)
  const count = annual ? 12 : new Date(year, month, 0).getDate()
  const years = transactions.map(transaction => Number(transaction.date.slice(0, 4)))
  const firstYear = years.length ? years.reduce((minimum, value) => Math.min(minimum, value), years[0]) : year
  const lastYear = years.length ? years.reduce((maximum, value) => Math.max(maximum, value), years[0]) : year
  const keys = allTime
    ? Array.from({ length: lastYear - firstYear + 1 }, (_, index) => String(firstYear + index))
    : Array.from({ length: count }, (_, index) => annual
      ? `${year}-${String(index + 1).padStart(2, '0')}`
      : `${period}-${String(index + 1).padStart(2, '0')}`)
  let sumIn = 0n,
    sumOut = 0n
  const exact = keys.map(key => {
    let income = 0n,
      expense = 0n
    for (const t of transactions) {
      if (annual || allTime ? t.date.startsWith(key) : t.date === key) {
        const n = BigInt(t.amount)
        if (n > 0n) income += n
        else expense -= n
      }
    }
    sumIn += income
    sumOut += expense
    return {
      label: allTime ? key : annual ? key.slice(5) : key.slice(8),
      income: cumulative ? sumIn : income,
      expense: cumulative ? sumOut : expense,
    }
  })
  const data = exact.map((point) => ({
    label: point.label,
    income: Number(point.income),
    expense: Number(point.expense),
  }))
  if (!transactions.length)
    return (
      <div className="chart-empty">
        <ChartNoAxesCombined size={26} strokeWidth={1.3} />
        <span>Dòng tiền bắt đầu từ giao dịch đầu tiên</span>
      </div>
    )
  return (
    <ChartContainer
      config={{
        income: { label: 'Doanh thu', color: '#249967' },
        expense: { label: 'Chi tiêu', color: '#eb8f2c' },
      }}
      className="chart-plot"
      role="img"
      aria-label={
        'Biểu đồ doanh thu và chi tiêu theo ' + (allTime ? 'năm' : annual ? 'tháng' : 'ngày')
      }
    >
      <AreaChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="incomeGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#249967" stopOpacity={0.21} />
            <stop offset="100%" stopColor="#249967" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="expenseGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e99a42" stopOpacity={0.16} />
            <stop offset="100%" stopColor="#e99a42" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="2 5"
          vertical={false}
          stroke="#e9eaed"
        />
        <XAxis
          dataKey="label"
          axisLine={false}
          tickLine={false}
          interval={allTime ? 'preserveStartEnd' : annual ? 1 : 4}
          tick={{ fill: '#9699a2', fontSize: 10 }}
          tickMargin={12}
          height={31}
        />
        <Tooltip
          cursor={{ stroke: '#c9cdd1', strokeDasharray: '3 3' }}
          content={({ active, label }) => {
            const point = exact.find((p) => p.label === label)
            return active && point ? (
              <div className="chart-tooltip">
                <strong>
                  {allTime ? 'Năm' : annual ? 'Tháng' : 'Ngày'} {label}
                </strong>
                <span className="positive">
                  Doanh thu: {formatAmount(point.income)} ₫
                </span>
                <span className="negative">
                  Chi tiêu: {formatAmount(point.expense)} ₫
                </span>
              </div>
            ) : null
          }}
        />
        <Area
          type="monotone"
          dataKey="income"
          stroke="#249967"
          strokeWidth={2}
          fill="url(#incomeGradient)"
          isAnimationActive={false}
          activeDot={{ r: 4, stroke: '#fcfcfd', strokeWidth: 2 }}
        />
        <Area
          type="monotone"
          dataKey="expense"
          stroke="#eb8f2c"
          strokeWidth={1.7}
          fill="url(#expenseGradient)"
          isAnimationActive={false}
          activeDot={{ r: 4, stroke: '#fcfcfd', strokeWidth: 2 }}
        />
      </AreaChart>
    </ChartContainer>
  )
}
