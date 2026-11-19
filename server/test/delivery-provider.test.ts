import { describe, expect, it } from 'vitest'
import {
  DeliveryProviderError,
  normalizedDeliveryStatuses,
  type DeliveryCancelRequest,
  type DeliveryDispatchRequest,
  type DeliveryOperationResult,
  type DeliveryProviderAdapter,
} from '../src/modules/delivery/provider-adapter.js'

class FakeDeliveryProvider implements DeliveryProviderAdapter {
  readonly calls = { dispatch: 0, cancel: 0 }
  private readonly operations = new Map<string, {
    fingerprint: string
    result: Promise<DeliveryOperationResult>
  }>()

  dispatch(request: DeliveryDispatchRequest) {
    return this.execute('dispatch', request.idempotencyKey, request, () => {
      this.calls.dispatch += 1
      return {
        deliveryId: `fake-${request.orderId}`,
        status: 'assigned',
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }
    })
  }

  cancel(request: DeliveryCancelRequest) {
    return this.execute('cancel', request.idempotencyKey, request, () => {
      this.calls.cancel += 1
      return {
        deliveryId: request.deliveryId,
        status: 'cancelled',
        updatedAt: new Date('2026-01-01T00:01:00.000Z'),
      }
    })
  }

  private execute(
    operation: 'dispatch' | 'cancel',
    idempotencyKey: string,
    request: DeliveryDispatchRequest | DeliveryCancelRequest,
    perform: () => DeliveryOperationResult,
  ): Promise<DeliveryOperationResult> {
    const key = `${operation}:${idempotencyKey}`
    const fingerprint = JSON.stringify(request)
    const previous = this.operations.get(key)
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        return Promise.reject(new DeliveryProviderError(
          'idempotency_conflict',
          'Idempotency key was already used for a different delivery operation',
          { retryable: false, manualFallback: 'available' },
        ))
      }
      return previous.result
    }

    const result = Promise.resolve(perform())
    this.operations.set(key, { fingerprint, result })
    return result
  }
}

describe('provider-independent delivery adapter contract', () => {
  it('exposes normalized delivery statuses', () => {
    expect(normalizedDeliveryStatuses).toEqual([
      'pending',
      'assigned',
      'picked_up',
      'in_transit',
      'delivered',
      'cancelled',
      'failed',
    ])
  })

  it('deduplicates dispatch retries and rejects key reuse with different input', async () => {
    const adapter = new FakeDeliveryProvider()
    const request = { orderId: 'order-1', idempotencyKey: 'dispatch-key' }

    const [first, retry] = await Promise.all([adapter.dispatch(request), adapter.dispatch(request)])

    expect(retry).toEqual(first)
    expect(adapter.calls.dispatch).toBe(1)
    await expect(adapter.dispatch({ ...request, orderId: 'order-2' })).rejects.toMatchObject({
      code: 'idempotency_conflict',
      retryable: false,
      manualFallback: 'available',
    })
    expect(adapter.calls.dispatch).toBe(1)
  })

  it('deduplicates cancellation retries independently from dispatch', async () => {
    const adapter = new FakeDeliveryProvider()
    const dispatch = await adapter.dispatch({ orderId: 'order-1', idempotencyKey: 'dispatch-key' })
    const request = {
      orderId: 'order-1',
      deliveryId: dispatch.deliveryId,
      idempotencyKey: 'cancel-key',
    }

    const [first, retry] = await Promise.all([adapter.cancel(request), adapter.cancel(request)])

    expect(first).toMatchObject({ deliveryId: dispatch.deliveryId, status: 'cancelled' })
    expect(retry).toEqual(first)
    expect(adapter.calls.cancel).toBe(1)
  })

  it('provides a provider-neutral retry and manual-fallback decision', () => {
    const error = new DeliveryProviderError('unavailable', 'Delivery service is unavailable', {
      retryable: true,
      manualFallback: 'recommended',
    })

    expect(error).toMatchObject({
      name: 'DeliveryProviderError',
      code: 'unavailable',
      retryable: true,
      manualFallback: 'recommended',
    })
  })
})
