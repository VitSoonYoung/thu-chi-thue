import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
export const MAX_VND = 9223372036854775807n
export function parseAmount(text: string): bigint | null {
  const value = text.trim().replace(/\s*₫$/, '').replace(/−/g, '-')
  if (!/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+|\d{1,3}(?:,\d{3})+)$/.test(value))
    return null
  try {
    const amount = BigInt(value.replace(/[.,+]/g, ''))
    return amount > MAX_VND || amount < -(MAX_VND + 1n) ? null : amount
  } catch {
    return null
  }
}
export function formatAmount(value: string | bigint, signed = false) {
  const n = BigInt(value || '0')
  return (signed && n > 0n ? '+' : '') + n.toLocaleString('vi-VN')
}
export function today() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date())
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch('/api' + path, options)
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('access:locked'))
    const body = await response
      .json()
      .catch(() => ({ error: 'Không thể kết nối tới ứng dụng' }))
    throw new Error(body.error || 'Không thể thực hiện thao tác')
  }
  return response.json()
}
export function json(method: string, data: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }
}
export type Category = {
  id: number
  name: string
  color: string
  kind: 'income' | 'expense' | 'both'
  references: number
}
export type Attachment = { id: number; name: string; size: number }
export type Transaction = {
  id: number
  amount: string
  usd_minor: string
  exchange_rate: string
  category_id: number
  date: string
  note: string
  deductible: boolean
  attachments: Attachment[]
}
export type State = {
  categories: Category[]
  transactions: Transaction[]
  settings: Record<string, string>
  today: string
}
export type Source = {
  title: string
  number: string
  url: string
  effective_from: string
  verified_at: string
  status: string
}
export type Rule = {
  year: number
  version: number
  threshold: number
  choice_limit: number
  middle_limit: number
  relief_limit: number
  revenue_bps: number
  low_bps: number
  middle_bps: number
  high_bps: number
  relief_bps: number
  effective_from: string
  verified_at: string
  status: string
  reason: string
  sources: Source[]
}
export type Method = {
  applicable: boolean
  reason: string
  base: string
  rate: number
  before: string
  reduction: string
  total: string
  after_tax: string
  your_share: string
  partner_share: string
}
export type Tax = {
  year: number
  rule: Rule | null
  revenue: string
  expenses: string
  deductible: string
  confirmed: boolean
  locked: boolean
  method: string
  revenue_method: Method
  profit_method: Method
}
