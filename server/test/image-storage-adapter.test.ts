import { describe, expect, it } from 'vitest'
import {
  ImageStorageError,
  supportedImageContentTypes,
  type ImageStorageAdapter,
  type StoredImageReference,
} from '../src/modules/images/image-storage-adapter.js'

class FakeImageStorageAdapter implements ImageStorageAdapter {
  readonly deletedKeys: string[] = []
  private readonly references = new Map<string, StoredImageReference>([
    ['test-image-1', {
      objectKey: 'test-image-1',
      contentType: 'image/webp',
      sizeBytes: 1024,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    }],
  ])

  async getReference(objectKey: string): Promise<StoredImageReference | null> {
    if (!objectKey || objectKey.includes('..') || objectKey.includes('/') || objectKey.includes('\\')) {
      throw new ImageStorageError('invalid_reference', 'Image object reference is invalid', false)
    }
    return this.references.get(objectKey) ?? null
  }

  async deleteObject(objectKey: string): Promise<void> {
    if (!objectKey || objectKey.includes('..') || objectKey.includes('/') || objectKey.includes('\\')) {
      throw new ImageStorageError('invalid_reference', 'Image object reference is invalid', false)
    }
    this.deletedKeys.push(objectKey)
    this.references.delete(objectKey)
  }
}

describe('provider-independent image storage contract', () => {
  it('limits references to normalized supported image content types', () => {
    expect(supportedImageContentTypes).toEqual(['image/jpeg', 'image/png', 'image/webp'])
  })

  it('returns deterministic metadata for a synthetic reference without image bytes', async () => {
    const adapter = new FakeImageStorageAdapter()

    await expect(adapter.getReference('test-image-1')).resolves.toEqual({
      objectKey: 'test-image-1',
      contentType: 'image/webp',
      sizeBytes: 1024,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    await expect(adapter.getReference('missing-image')).resolves.toBeNull()
  })

  it('deletes only the addressed synthetic reference', async () => {
    const adapter = new FakeImageStorageAdapter()

    await adapter.deleteObject('test-image-1')

    expect(adapter.deletedKeys).toEqual(['test-image-1'])
    await expect(adapter.getReference('test-image-1')).resolves.toBeNull()
  })

  it('rejects path-like object references with a neutral error', async () => {
    const adapter = new FakeImageStorageAdapter()

    await expect(adapter.getReference('../private')).rejects.toMatchObject({
      name: 'ImageStorageError',
      code: 'invalid_reference',
      retryable: false,
    })
  })
})
