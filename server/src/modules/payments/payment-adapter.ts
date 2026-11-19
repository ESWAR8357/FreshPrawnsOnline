export const paymentStatuses = [
  'pending',
  'requires_action',
  'authorized',
  'captured',
  'failed',
  'cancelled',
  'partially_refunded',
  'refunded',
] as const

export type PaymentStatus = typeof paymentStatuses[number]

export interface CreatePaymentIntentRequest {
  orderId: string
  amountPaise: number
  idempotencyKey: string
}

export interface RefundPaymentRequest {
  paymentId: string
  amountPaise: number
  idempotencyKey: string
}

export interface PaymentIntent {
  paymentId: string
  orderId: string
  amountPaise: number
  currency: 'INR'
  status: PaymentStatus
  refundedPaise: number
  createdAt: Date
  updatedAt: Date
}

export type PaymentAdapterErrorCode =
  | 'unavailable'
  | 'rejected'
  | 'not_found'
  | 'already_refunded'
  | 'idempotency_conflict'
  | 'invalid_response'

export class PaymentAdapterError extends Error {
  constructor(
    readonly code: PaymentAdapterErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'PaymentAdapterError'
  }
}

export interface PaymentAdapter {
  createPaymentIntent(request: CreatePaymentIntentRequest): Promise<PaymentIntent>
  getPayment(paymentId: string): Promise<PaymentIntent>
  refundPayment(request: RefundPaymentRequest): Promise<PaymentIntent>
}
