import { describe, expect, it } from 'vitest'
import { parseStockDelta, rupeesToPaise } from './admin.js'

describe('admin input conversion', () => {
  it('converts rupees to safe integer paise', () => {
    expect(rupeesToPaise('680.25')).toBe(68025)
    expect(() => rupeesToPaise('680.256')).toThrow()
    expect(() => rupeesToPaise('0')).toThrow()
  })

  it('accepts only bounded, non-zero whole-gram stock adjustments', () => {
    expect(parseStockDelta('-250')).toBe(-250)
    expect(parseStockDelta('1000000')).toBe(1000000)
    expect(() => parseStockDelta('1.5')).toThrow()
    expect(() => parseStockDelta('0')).toThrow()
    expect(() => parseStockDelta('1000001')).toThrow()
  })
})
