import { describe, expect, it } from 'vitest'
import {
  NotificationAdapterError,
  notificationChannels,
  notificationStatuses,
  type NotificationAdapter,
  type NotificationResult,
  type SendNotificationRequest,
} from '../src/modules/notifications/notification-adapter.js'

class FakeNotificationAdapter implements NotificationAdapter {
  readonly recorded: SendNotificationRequest[] = []
  private readonly operations = new Map<string, { fingerprint: string; result: NotificationResult }>()

  async send(request: SendNotificationRequest): Promise<NotificationResult> {
    if (!request.recipientRef.trim() || !request.templateKey.trim()) {
      throw new NotificationAdapterError('invalid_request', 'Recipient reference and template are required', false)
    }
    if (Object.entries(request.variables).some(([key, value]) => (
      !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)
      || (typeof value === 'string' && value.length > 200)
      || (typeof value === 'number' && !Number.isFinite(value))
    ))) {
      throw new NotificationAdapterError('invalid_request', 'Template variables are invalid', false)
    }

    const fingerprint = JSON.stringify(request)
    const previous = this.operations.get(request.idempotencyKey)
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new NotificationAdapterError(
          'idempotency_conflict',
          'Idempotency key was reused with different notification details',
          false,
        )
      }
      return previous.result
    }

    this.recorded.push(request)
    const result = {
      notificationId: `fake-notification-${this.recorded.length}`,
      status: 'queued' as const,
      acceptedAt: new Date('2026-01-01T00:00:00.000Z'),
    }
    this.operations.set(request.idempotencyKey, { fingerprint, result })
    return result
  }
}

describe('provider-independent notification adapter contract', () => {
  it('exposes normalized channels and outcomes', () => {
    expect(notificationChannels).toEqual(['email', 'sms'])
    expect(notificationStatuses).toEqual(['queued', 'sent', 'delivered', 'failed', 'rejected'])
  })

  it('records a deterministic test notification without external delivery', async () => {
    const adapter = new FakeNotificationAdapter()
    const request = {
      idempotencyKey: 'notice-1',
      recipientRef: 'customer-reference-1',
      channel: 'email' as const,
      templateKey: 'order-confirmed',
      variables: { orderNumber: 'FP-1001' },
    }

    const result = await adapter.send(request)

    expect(result).toMatchObject({ notificationId: 'fake-notification-1', status: 'queued' })
    expect(adapter.recorded).toEqual([request])
  })

  it('replays identical sends and rejects changed input for an existing key', async () => {
    const adapter = new FakeNotificationAdapter()
    const request = {
      idempotencyKey: 'notice-1',
      recipientRef: 'customer-reference-1',
      channel: 'sms' as const,
      templateKey: 'order-update',
      variables: { status: 'preparing' },
    }

    const first = await adapter.send(request)
    const retry = await adapter.send(request)

    expect(retry).toEqual(first)
    expect(adapter.recorded).toHaveLength(1)
    await expect(adapter.send({ ...request, templateKey: 'order-cancelled' }))
      .rejects.toMatchObject({ code: 'idempotency_conflict', retryable: false })
    expect(adapter.recorded).toHaveLength(1)
  })

  it('rejects missing recipient references and templates', async () => {
    const adapter = new FakeNotificationAdapter()
    await expect(adapter.send({
      idempotencyKey: 'notice-1',
      recipientRef: ' ',
      channel: 'email',
      templateKey: 'order-update',
      variables: {},
    })).rejects.toBeInstanceOf(NotificationAdapterError)
  })

  it('rejects unbounded or malformed template variables', async () => {
    const adapter = new FakeNotificationAdapter()
    await expect(adapter.send({
      idempotencyKey: 'notice-2',
      recipientRef: 'customer-reference-1',
      channel: 'email',
      templateKey: 'order-update',
      variables: { 'customer.phone': 'not permitted' },
    })).rejects.toMatchObject({ code: 'invalid_request', retryable: false })
    await expect(adapter.send({
      idempotencyKey: 'notice-3',
      recipientRef: 'customer-reference-1',
      channel: 'email',
      templateKey: 'order-update',
      variables: { summary: 'x'.repeat(201) },
    })).rejects.toMatchObject({ code: 'invalid_request', retryable: false })
  })
})
