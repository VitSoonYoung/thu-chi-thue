import { describe, expect, it } from 'vitest'
import { formatAmount, MAX_VND, parseAmount } from './lib'
describe('VND amounts', () => {
  it.each([
    ['+1.000.000', 1000000n],
    ['-1.000.000', -1000000n],
    ['+1,200,000', 1200000n],
    ['-1200000', -1200000n],
    ['0', 0n],
    [' 12.500.000 ₫ ', 12500000n],
    ['−750.000', -750000n],
    [MAX_VND.toString(), MAX_VND],
    ['-9223372036854775808', -9223372036854775808n],
  ])('parses %s exactly', (input, value) => {
    expect(parseAmount(input)).toBe(value)
  })
  it.each([
    '',
    '+',
    '-',
    '1.2',
    '1,50',
    '1.200,000',
    '12abc',
    '1e9',
    '1 000',
    '9223372036854775808',
    '-9223372036854775809',
    '<script>',
  ])('rejects %s', (input) => {
    expect(parseAmount(input)).toBe(null)
  })
  it('formats full integer precision', () => {
    expect(formatAmount(MAX_VND)).toBe('9.223.372.036.854.775.807')
    expect(formatAmount(-1000000n)).toBe('-1.000.000')
    expect(formatAmount(1000000n, true)).toBe('+1.000.000')
  })
})
