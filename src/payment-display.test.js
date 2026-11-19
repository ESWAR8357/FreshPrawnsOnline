import { describe, expect, it } from 'vitest'
import { toPaymentDisplay } from './payment-display.js'

describe('payment display mapping', () => {
  it('labels pay-on-delivery orders without implying payment was collected', () => {
    expect(toPaymentDisplay({
      paymentMethod: 'pay_on_delivery',
      paymentStatus: 'pending_collection',
    })).toEqual({
      paymentMethodLabel: 'Pay on delivery',
      paymentStatus: 'pending_collection',
      paymentStatusLabel: 'Pending collection',
      paymentCollectedAt: null,
    })
  })

  it('shows collection and cancellation states from the server', () => {
    expect(toPaymentDisplay({ paymentMethod: 'pay_on_delivery', paymentStatus: 'collected' })).toMatchObject({
      paymentStatus: 'collected',
      paymentStatusLabel: 'Collected',
    })
    expect(toPaymentDisplay({ paymentMethod: 'pay_on_delivery', paymentStatus: 'not_collectible' })).toMatchObject({
      paymentStatus: 'not_collectible',
      paymentStatusLabel: 'Not collectible',
    })
  })

  it('uses safe display fallbacks for legacy orders', () => {
    expect(toPaymentDisplay({})).toMatchObject({
      paymentMethodLabel: 'Unavailable',
      paymentStatus: 'pending_collection',
      paymentStatusLabel: 'Pending collection',
    })
  })
})
