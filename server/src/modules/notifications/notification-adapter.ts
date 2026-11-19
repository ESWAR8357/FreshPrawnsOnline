export const notificationChannels = ['email', 'sms'] as const
export type NotificationChannel = typeof notificationChannels[number]

export const notificationStatuses = ['queued', 'sent', 'delivered', 'failed', 'rejected'] as const
export type NotificationStatus = typeof notificationStatuses[number]

export type NotificationVariable = string | number

export interface SendNotificationRequest {
  idempotencyKey: string
  recipientRef: string
  channel: NotificationChannel
  templateKey: string
  variables: Readonly<Record<string, NotificationVariable>>
}

export interface NotificationResult {
  notificationId: string
  status: NotificationStatus
  acceptedAt: Date
}

export type NotificationAdapterErrorCode =
  | 'unavailable'
  | 'rejected'
  | 'invalid_request'
  | 'idempotency_conflict'
  | 'invalid_response'

export class NotificationAdapterError extends Error {
  constructor(
    readonly code: NotificationAdapterErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'NotificationAdapterError'
  }
}

export interface NotificationAdapter {
  send(request: SendNotificationRequest): Promise<NotificationResult>
}
