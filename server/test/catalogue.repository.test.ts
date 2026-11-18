import { Types } from 'mongoose'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DailyPrice } from '../src/modules/pricing/daily-price.model.js'
import { Stock } from '../src/modules/inventory/stock.model.js'
import { MongoCatalogueRepository } from '../src/modules/products/catalogue.repository.js'
import { Product } from '../src/modules/products/product.model.js'

describe('Mongo catalogue repository', () => {
  afterEach(() => vi.restoreAllMocks())

  it('uses the current effective price and reports unreserved stock in grams', async () => {
    const productId = new Types.ObjectId()
    const now = new Date('2026-11-18T10:00:00.000Z')
    const effectiveFrom = new Date('2026-11-18T00:00:00.000Z')
    const product = {
      _id: productId,
      slug: 'white-prawns',
      name: 'White Prawns',
      description: 'Sweet and versatile.',
      longDescription: 'Fresh medium prawns.',
      size: 'Medium',
      origin: 'Coastal catch',
      badge: 'BESTSELLER',
      imageUrl: 'https://example.test/white-prawns.jpg',
      active: true,
      sampleData: false,
      preparationOptions: [
        { type: 'cleaned', enabled: true, feePaise: 4000 },
        { type: 'uncleaned', enabled: true, feePaise: 0 },
      ],
    }

    vi.spyOn(Product, 'find').mockReturnValue({
      sort: () => ({ lean: async () => [product] }),
    } as never)
    vi.spyOn(DailyPrice, 'find').mockReturnValue({
      sort: () => ({
        lean: async () => [
          { productId, pricePerKgPaise: 68000, effectiveFrom },
          { productId, pricePerKgPaise: 50000, effectiveFrom: new Date('2026-11-17T00:00:00.000Z') },
        ],
      }),
    } as never)
    vi.spyOn(Stock, 'find').mockReturnValue({
      lean: async () => [{ productId, onHandGrams: 10000, reservedGrams: 2500 }],
    } as never)

    const [item] = await new MongoCatalogueRepository().list(
      { size: 'Medium', preparation: 'cleaned' },
      now,
    )

    expect(item).toMatchObject({
      id: 'white-prawns',
      pricePerKgPaise: 68000,
      priceEffectiveFrom: effectiveFrom.toISOString(),
      preparationOptions: product.preparationOptions,
      stock: { onHandGrams: 10000, availableGrams: 7500 },
    })
    expect(DailyPrice.find).toHaveBeenCalledWith(expect.objectContaining({
      effectiveFrom: { $lte: now },
      $or: [{ effectiveTo: null }, { effectiveTo: { $gt: now } }],
    }))
    expect(Product.find).toHaveBeenCalledWith(expect.objectContaining({
      active: true,
      size: 'Medium',
      preparationOptions: { $elemMatch: { type: 'cleaned', enabled: true } },
    }))
  })
})
