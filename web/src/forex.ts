import { MAX_VND } from './lib'
export function parseUSD(text: string): bigint | null {
  if ((text.match(/\$/g) || []).length !== 1) return null
  const raw = text.replace('$', '').trim().replace(/−/g, '-')
  const negative = raw.startsWith('-')
  const unsigned = raw.replace(/^[+-]/, '')
  let whole: string, fraction: string
  if (/^\d+(?:\.\d{1,2})?$/.test(unsigned)) [whole, fraction = ''] = unsigned.split('.')
  else if (/^\d+(?:,\d{1,2})?$/.test(unsigned)) [whole, fraction = ''] = unsigned.split(',')
  else if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(unsigned)) [whole, fraction = ''] = unsigned.replace(/,/g, '').split('.')
  else if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(unsigned)) [whole, fraction = ''] = unsigned.replace(/\./g, '').split(',')
  else return null
  try {
    const cents = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))) * (negative ? -1n : 1n)
    return cents > MAX_VND || cents < -(MAX_VND + 1n) ? null : cents
  } catch { return null }
}
export function validRate(rate: string): bigint | null {
  if (!/^\d+$/.test(rate)) return null
  const value = BigInt(rate)
  return value > 0n && value <= 1000000000n ? value : null
}
export function roundRatio(value: bigint, divisor: bigint): bigint {
  const absolute = value < 0n ? -value : value
  const result = (absolute + divisor / 2n) / divisor
  return value < 0n ? -result : result
}
export function usdToVND(cents: bigint, rate: string): bigint | null {
  const exchange = validRate(rate)
  if (!exchange) return null
  const result = roundRatio(cents * exchange, 100n)
  return result <= MAX_VND && result >= -(MAX_VND + 1n) ? result : null
}
export function vndToUSD(amount: bigint | string, rate: string): bigint | null {
  const exchange = validRate(rate)
  return exchange ? roundRatio(BigInt(amount) * 100n, exchange) : null
}
export function formatUSD(cents: bigint | string): string {
  const value = BigInt(cents), absolute = value < 0n ? -value : value
  return (value < 0n ? '-' : '') + '$' + (absolute / 100n).toLocaleString('vi-VN') + ',' + (absolute % 100n).toString().padStart(2, '0')
}
