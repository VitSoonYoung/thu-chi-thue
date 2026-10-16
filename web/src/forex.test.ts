import { describe, expect, it } from 'vitest'
import { formatUSD, parseUSD, usdToVND, vndToUSD } from './forex'
describe('USD conversion', () => {
  it.each([['$100', 10000n], ['-$100.50', -10050n], ['$-100,50', -10050n], ['100$', 10000n], ['$1,234.56', 123456n], ['$1.234,56', 123456n], ['$1,234', 123400n], ['$1.234', 123400n], ['$0.01', 1n]])('parses %s as cents', (raw, cents) => expect(parseUSD(raw)).toBe(cents))
  it.each(['$1.2345', '$1,23,4', '$1e3', '$$100', '$abc', '100', '$-+100'])('rejects ambiguous %s', raw => expect(parseUSD(raw)).toBe(null))
  it('converts exact cents and rounds half away from zero', () => {
    expect(usdToVND(10050n, '25000')).toBe(2512500n)
    expect(usdToVND(1n, '25050')).toBe(251n)
    expect(usdToVND(-1n, '25050')).toBe(-251n)
    expect(usdToVND(9223372036854775807n, '25000')).toBe(null)
    expect(usdToVND(100n, '0')).toBe(null)
    expect(vndToUSD(2512500n, '25000')).toBe(10050n)
    expect(formatUSD(-123456n)).toBe('-$1.234,56')
  })
})
