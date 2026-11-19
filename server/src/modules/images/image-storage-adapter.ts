export const supportedImageContentTypes = ['image/jpeg', 'image/png', 'image/webp'] as const
export type SupportedImageContentType = typeof supportedImageContentTypes[number]

export interface StoredImageReference {
  objectKey: string
  contentType: SupportedImageContentType
  sizeBytes: number
  createdAt: Date
}

export type ImageStorageErrorCode =
  | 'unavailable'
  | 'not_found'
  | 'invalid_reference'
  | 'invalid_response'

export class ImageStorageError extends Error {
  constructor(
    readonly code: ImageStorageErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'ImageStorageError'
  }
}

export interface ImageStorageAdapter {
  getReference(objectKey: string): Promise<StoredImageReference | null>
  deleteObject(objectKey: string): Promise<void>
}
