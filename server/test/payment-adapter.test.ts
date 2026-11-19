import { describe, expect, it } from 'vitest'
import {
  PaymentAdapterError,
  paymentStatuses,
  type CreatePaymentIntentRequest,
  type PaymentAdapter,
  type PaymentIntent,
  type RefundPaymentRequest,
} from '../src/modules/payments/payment-adapter.js'

class FakePaymentAdapter implements PaymentAdapter {
  private readonly payments = new Map<string, PaymentIntent>()
  private readonly idempotency = new Map<string, { fingerprint: string; result: PaymentIntent }>()
  private nextId = 1

  async createPaymentIntent(request: CreatePaymentIntentRequest): Promise<PaymentIntent> {
    assertAmount(request.amountPaise)
    const key = `create:${request.idempotencyKey}`
    const replay = this.findReplay(key, request)
    if (replay) return replay

    const now = new Date('2026-01-01T00:00:00.000Z')
    const payment: PaymentIntent = {
      paymentId: `fake-payment-${this.nextId++}`,
      orderId: request.orderId,
      amountPaise: request.amountPaise,
      currency: 'INR',
      status: 'pending',
      refundedPaise: 0,
      createdAt: now,
      updatedAt: now,
    }
    this.payments.set(payment.paymentId, payment)
    this.idempotency.set(key, { fingerprint: JSON.stringify(request), result: payment })
    return payment
  }

  async getPayment(paymentId: string): Promise<PaymentIntent> {
    const payment = this.payments.get(paymentId)
    if (!payment) throw new PaymentAdapterError('not_found', 'Payment was not found', false)
    return payment
  }

  async refundPayment(request: RefundPaymentRequest): Promise<PaymentIntent> {
    assertAmount(request.amountPaise)
    const key = `refund:${request.idempotencyKey}`
    const replay = this.findReplay(key, request)
    if (replay) return replay
    const payment = await this.getPayment(request.paymentId)
    const remaining = payment.amountPaise - payment.refundedPaise
    if (payment.status !== 'captured' && payment.status !== 'partially_refunded') {
      throw new PaymentAdapterError('rejected', 'Only captured payments can be refunded', false)
    }
    if (request.amountPaise > remaining) {
      throw new PaymentAdapterError('rejected', 'Refund exceeds the unrefunded amount', false)
    }
    const updated: PaymentIntent = {
      ...payment,
      refundedPaise: payment.refundedPaise + request.amountPaise,
      status: payment.refundedPaise + request.amountPaise === payment.amountPaise
        ? 'refunded'
        : 'partially_refunded',
      updatedAt: new Date('2026-01-01T00:01:00.000Z'),
    }
    this.payments.set(updated.paymentId, updated)
    this.idempotency.set(key, { fingerprint: JSON.stringify(request), result: updated })
    return updated
  }

  captureForTest(paymentId: string): void {
    const payment = this.payments.get(paymentId)
    if (!payment) throw new PaymentAdapterError('not_found', 'Payment was not found', false)
    this.payments.set(paymentId, {
      ...payment,
      status: 'captured',
      updatedAt: new Date('2026-01-01T00:00:30.000Z'),
    })
  }

  private findReplay(
    key: string,
    request: CreatePaymentIntentRequest | RefundPaymentRequest,
  ): PaymentIntent | undefined {
    const existing = this.idempotency.get(key)
    if (!existing) return undefined
    if (existing.fingerprint !== JSON.stringify(request)) {
      throw new PaymentAdapterError(
        'idempotency_conflict',
        'Idempotency key was reused with different payment details',
        false,
      )
    }
    return existing.result
  }
}

function assertAmount(amountPaise: number): void {
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    throw new PaymentAdapterError('rejected', 'Amount must be positive integer paise', false)
  }
}

describe('provider-independent payment adapter contract', () => {
  it('exposes normalized payment statuses', () => {
    expect(paymentStatuses).toEqual([
      'pending',
      'requires_action',
      'authorized',
      'captured',
      'failed',
      'cancelled',
      'partially_refunded',
      'refunded',
    ])
  })

  it('creates deterministic payment intents and replays idempotent requests', async () => {
    const adapter = new FakePaymentAdapter()
    const request = { orderId: 'order-1', amountPaise: 42000, idempotencyKey: 'create-1' }

    const first = await adapter.createPaymentIntent(request)
    const retry = await adapter.createPaymentIntent(request)

    expect(first.paymentId).toBe('fake-payment-1')
    expect(first).toEqual(retry)
    expect(first).toMatchObject({ amountPaise: 42000, currency: 'INR', status: 'pending' })
    await expect(adapter.createPaymentIntent({ ...request, amountPaise: 43000 }))
      .rejects.toMatchObject({ code: 'idempotency_conflict', retryable: false })
  })

  it('returns normalized payment state and applies idempotent bounded refunds', async () => {
    const adapter = new FakePaymentAdapter()
    const payment = await adapter.createPaymentIntent({
      orderId: 'order-1',
      amountPaise: 42000,
      idempotencyKey: 'create-1',
    })
    adapter.captureForTest(payment.paymentId)

    const refundRequest = { paymentId: payment.paymentId, amountPaise: 12000, idempotencyKey: 'refund-1' }
    const refund = await adapter.refundPayment(refundRequest)
    const retry = await adapter.refundPayment(refundRequest)

    expect(refund).toMatchObject({ refundedPaise: 12000, status: 'partially_refunded' })
    expect(retry).toEqual(refund)
    await expect(adapter.getPayment(payment.paymentId)).resolves.toEqual(refund)
    await expect(adapter.refundPayment({
      paymentId: payment.paymentId,
      amountPaise: 30001,
      idempotencyKey: 'refund-2',
    })).rejects.toMatchObject({ code: 'rejected', retryable: false })
  })

  it('rejects invalid amounts and missing payment identifiers safely', async () => {
    const adapter = new FakePaymentAdapter()
    await expect(adapter.createPaymentIntent({
      orderId: 'order-1',
      amountPaise: 0,
      idempotencyKey: 'create-1',
    })).rejects.toMatchObject({ code: 'rejected', retryable: false })
    await expect(adapter.getPayment('missing')).rejects.toBeInstanceOf(PaymentAdapterError)
  })
})
