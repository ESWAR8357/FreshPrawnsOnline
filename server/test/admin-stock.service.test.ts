import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({
  productExists: vi.fn(),
  findStock: vi.fn(),
  findStockById: vi.fn(),
  createStock: vi.fn(),
  updateStock: vi.fn(),
}))

vi.mock('../src/modules/products/product.model.js', () => ({
  Product: { exists: database.productExists },
}))
vi.mock('../src/modules/inventory/stock.model.js', () => ({
  Stock: {
    findOne: database.findStock,
    findById: database.findStockById,
    create: database.createStock,
    findOneAndUpdate: database.updateStock,
  },
}))

import { MongoAdminStockService } from '../src/modules/admin/stock.service.js'

describe('admin stock service', () => {
  const productId = new Types.ObjectId().toString()
  const adminId = new Types.ObjectId().toString()
  const stockId = new Types.ObjectId()
  const service = new MongoAdminStockService()

  beforeEach(() => {
    vi.clearAllMocks()
    database.productExists.mockResolvedValue({ _id: productId })
    database.findStock.mockResolvedValue({ _id: stockId, reservedGrams: 500, movements: [] })
  })

  it('updates stock and appends its idempotent movement atomically on one stock document', async () => {
    database.updateStock.mockImplementation(async (_filter, update) => ({
      movements: [update.$push.movements],
    }))
    const input = {
      idempotencyKey: 'b307034e-fba6-4d61-9a41-9b3978060f1c',
      deltaGrams: -250,
      reason: 'spoilage' as const,
      reference: 'Daily quality check',
    }

    const movement = await service.adjust(productId, adminId, input)

    expect(movement).toMatchObject({
      operationId: `${adminId}:${input.idempotencyKey}`,
      deltaGrams: -250,
      reservedDeltaGrams: 0,
      reason: 'spoilage',
    })
    expect(database.updateStock).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: stockId,
        'movements.operationId': { $ne: `${adminId}:${input.idempotencyKey}` },
        $expr: expect.any(Object),
      }),
      expect.objectContaining({
        $inc: { onHandGrams: -250 },
        $push: { movements: expect.objectContaining({ reason: 'spoilage' }) },
      }),
      { new: true, runValidators: true },
    )
  })

  it('returns an existing movement for an idempotent retry without applying it again', async () => {
    const input = {
      idempotencyKey: 'b307034e-fba6-4d61-9a41-9b3978060f1c',
      deltaGrams: 250,
      reason: 'received' as const,
    }
    const prior = { operationId: `${adminId}:${input.idempotencyKey}`, deltaGrams: 250 }
    database.findStock.mockResolvedValue({ _id: stockId, reservedGrams: 0, movements: [prior] })

    await expect(service.adjust(productId, adminId, input)).resolves.toBe(prior)
    expect(database.updateStock).not.toHaveBeenCalled()
  })

  it('rejects a decrement that would consume reserved stock', async () => {
    database.updateStock.mockResolvedValue(null)
    database.findStockById.mockResolvedValue({ movements: [] })

    await expect(service.adjust(productId, adminId, {
      idempotencyKey: 'b307034e-fba6-4d61-9a41-9b3978060f1c',
      deltaGrams: -600,
      reason: 'spoilage',
    })).rejects.toMatchObject({ code: 'INSUFFICIENT_AVAILABLE_STOCK' })
  })

  it('lists the embedded stock movement history', async () => {
    const movement = { operationId: 'entry-1', deltaGrams: 100, createdAt: new Date() }
    database.findStock.mockReturnValue({ lean: vi.fn().mockResolvedValue({ movements: [movement] }) })

    await expect(service.movements(productId, 20, 0)).resolves.toEqual({ items: [movement], total: 1 })
    expect(database.productExists).toHaveBeenCalledWith({ _id: productId })
  })
})
