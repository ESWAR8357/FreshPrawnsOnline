import { describe, expect, it } from 'vitest'
import { HttpError } from '../src/http-error.js'
import { calculateOrderLineTotalPaise } from '../src/modules/orders/orders.service.js'

describe('server-side order price calculation', () => {
  it('calculates the selected weight, cleaning fee, and quantity in integer paise', () => {
    expect(calculateOrderLineTotalPaise(68000, 4000, 500, 1)).toBe(38000)
    expect(calculateOrderLineTotalPaise(68000, 4000, 1000, 2)).toBe(144000)
    expect(calculateOrderLineTotalPaise(68000, 0, 250, 1)).toBe(17000)
  })

  it('rejects totals outside JavaScript safe integer precision', () => {
    expect(() => calculateOrderLineTotalPaise(Number.MAX_SAFE_INTEGER, 0, 1000, 2))
      .toThrowError(expect.objectContaining<HttpError>({ code: 'ORDER_TOTAL_TOO_LARGE' }))
  })
})
