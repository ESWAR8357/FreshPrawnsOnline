export const normalizedDeliveryStatuses = [
  'pending',
  'assigned',
  'picked_up',
  'in_transit',
  'delivered',
  'cancelled',
  'failed',
] as const

export type NormalizedDeliveryStatus = typeof normalizedDeliveryStatuses[number]
export type ManualFallbackDisposition = 'available' | 'recommended' | 'required'

export interface DeliveryDispatchRequest {
  orderId: string
  idempotencyKey: string
}

export interface DeliveryCancelRequest {
  orderId: string
  deliveryId: string
  idempotencyKey: string
}

export interface DeliveryOperationResult {
  deliveryId: string
  status: NormalizedDeliveryStatus
  updatedAt: Date
}

export type DeliveryProviderErrorCode =
  | 'unavailable'
  | 'rejected'
  | 'not_found'
  | 'already_completed'
  | 'idempotency_conflict'
  | 'invalid_response'

export interface DeliveryProviderErrorOptions {
  retryable: boolean
  manualFallback: ManualFallbackDisposition
}

export class DeliveryProviderError extends Error {
  readonly code: DeliveryProviderErrorCode
  readonly retryable: boolean
  readonly manualFallback: ManualFallbackDisposition

  constructor(
    code: DeliveryProviderErrorCode,
    message: string,
    options: DeliveryProviderErrorOptions,
  ) {
    super(message)
    this.name = 'DeliveryProviderError'
    this.code = code
    this.retryable = options.retryable
    this.manualFallback = options.manualFallback
  }
}

export interface DeliveryProviderAdapter {
  // Replays with the same operation, key, and input return the original result; changed input must reject.
  dispatch(request: DeliveryDispatchRequest): Promise<DeliveryOperationResult>
  cancel(request: DeliveryCancelRequest): Promise<DeliveryOperationResult>
}
