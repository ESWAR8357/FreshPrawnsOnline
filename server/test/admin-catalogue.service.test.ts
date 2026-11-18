import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({
  productExists: vi.fn(),
  findPrice: vi.fn(),
  updatePrice: vi.fn(),
  createPrice: vi.fn(),
}))

vi.mock('../src/modules/products/product.model.js', () => ({
  Product: { exists: database.productExists },
}))
vi.mock('../src/modules/pricing/daily-price.model.js', () => ({
  DailyPrice: {
    findOne: database.findPrice,
    updateOne: database.updatePrice,
    create: database.createPrice,
  },
}))

import { hyderabadDayStart, MongoAdminCatalogueService } from '../src/modules/admin/catalogue.service.js'

describe('admin catalogue service', () => {
  const productId = new Types.ObjectId().toString()
  const adminId = new Types.ObjectId().toString()
  const service = new MongoAdminCatalogueService()

  beforeEach(() => {
    vi.clearAllMocks()
    database.productExists.mockResolvedValue({ _id: productId })
  })

  it('interprets the effective day at midnight in Hyderabad', () => {
    expect(hyderabadDayStart('2026-11-19').toISOString()).toBe('2026-11-18T18:30:00.000Z')
    expect(() => hyderabadDayStart('2026-02-30')).toThrowError()
  })

  it('appends a price after closing the prior open-ended price', async () => {
    const previous = {
      _id: new Types.ObjectId(),
      effectiveFrom: hyderabadDayStart('2026-11-18'),
      effectiveTo: null,
    }
    const created = { productId, pricePerKgPaise: 68000 }
    database.findPrice
      .mockReturnValueOnce({ sort: vi.fn().mockResolvedValue(previous) })
      .mockReturnValueOnce({ sort: vi.fn().mockResolvedValue(previous) })
    database.updatePrice.mockResolvedValue({ modifiedCount: 1 })
    database.createPrice.mockResolvedValue(created)

    await expect(service.addPrice(productId, {
      effectiveDate: '2026-11-19',
      pricePerKgPaise: 68000,
    }, adminId)).resolves.toBe(created)

    const effectiveFrom = hyderabadDayStart('2026-11-19')
    expect(database.updatePrice).toHaveBeenCalledWith(
      { _id: previous._id, effectiveTo: null },
      { $set: { effectiveTo: effectiveFrom } },
    )
    expect(database.createPrice).toHaveBeenCalledWith(expect.objectContaining({
      productId: expect.any(Types.ObjectId),
      pricePerKgPaise: 68000,
      effectiveFrom,
      effectiveTo: null,
      changedById: expect.any(Types.ObjectId),
    }))
  })

  it('rejects a backdated price instead of creating overlapping history', async () => {
    database.findPrice.mockReturnValue({
      sort: vi.fn().mockResolvedValue({ effectiveFrom: hyderabadDayStart('2026-11-20') }),
    })

    await expect(service.addPrice(productId, {
      effectiveDate: '2026-11-19',
      pricePerKgPaise: 68000,
    }, adminId)).rejects.toMatchObject({ code: 'PRICE_DATE_NOT_LATEST' })
    expect(database.createPrice).not.toHaveBeenCalled()
  })
})
