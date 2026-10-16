import { describe, expect, it } from 'vitest'
import { calendarDays, dailyTotals } from './components/DailyActivity'
import type { Transaction } from './lib'

describe('daily activity calendar', () => {
  it('includes each day once across both halves of a regular year', () => {
    const days = [...calendarDays(2026, 0, 6).days, ...calendarDays(2026, 6, 12).days]
    expect(days).toHaveLength(365)
    expect(new Set(days.map(day => day.date)).size).toBe(365)
    expect(days[0].date).toBe('2026-01-01')
    expect(days.at(-1)?.date).toBe('2026-12-31')
    expect(calendarDays(2026).offset).toBe(3)
  })
  it('includes February 29 in leap years, respecting century rules', () => {
    expect(calendarDays(2024).days).toHaveLength(366)
    expect(calendarDays(2024).days.some(day => day.date === '2024-02-29')).toBe(true)
    expect(calendarDays(2000).days).toHaveLength(366)
    expect(calendarDays(2100).days).toHaveLength(365)
  })
  it('aggregates signed amounts without losing integer precision', () => {
    const transactions = [
      { id: 1, date: '2026-03-12', amount: '9223372036854775807' },
      { id: 2, date: '2026-03-12', amount: '-2' },
      { id: 3, date: '2026-03-13', amount: '-5000' },
    ] as Transaction[]
    const totals = dailyTotals(transactions)
    expect(totals.get('2026-03-12')?.total).toBe(9223372036854775805n)
    expect(totals.get('2026-03-12')?.transactions).toHaveLength(2)
    expect(totals.get('2026-03-13')?.total).toBe(-5000n)
    expect(totals.has('2026-03-14')).toBe(false)
  })
})
