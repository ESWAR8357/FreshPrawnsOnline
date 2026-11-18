import { Types } from 'mongoose'
import { HttpError } from '../../http-error.js'
import { DailyPrice } from '../pricing/daily-price.model.js'
import { Product } from '../products/product.model.js'
import type { AdminCatalogueService, AdminProductInput } from './catalogue.routes.js'

export function hyderabadDayStart(date: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  const calendarDate = new Date(Date.UTC(year, month - 1, day))
  if (!year || !month || !day || calendarDate.toISOString().slice(0, 10) !== date) {
    throw new HttpError(400, 'INVALID_EFFECTIVE_DATE', 'Effective date is invalid')
  }
  return new Date(`${date}T00:00:00+05:30`)
}

export class MongoAdminCatalogueService implements AdminCatalogueService {
  async list(filter: { active?: 'true' | 'false'; size?: 'Small' | 'Medium' | 'Large'; limit: number; offset: number }) {
    const query: Record<string, unknown> = {}
    if (filter.active) query.active = filter.active === 'true'
    if (filter.size) query.size = filter.size
    const [items, total] = await Promise.all([
      Product.find(query).sort({ name: 1, _id: 1 }).skip(filter.offset).limit(filter.limit).lean(),
      Product.countDocuments(query),
    ])
    return { items, total }
  }

  async get(productId: string) {
    const product = await Product.findById(productId).lean()
    if (!product) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product not found')
    return product
  }

  async create(input: AdminProductInput) {
    try {
      return await Product.create({ ...input, imageUrl: input.imageUrl || undefined, sampleData: false })
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
        throw new HttpError(409, 'PRODUCT_SLUG_EXISTS', 'A product with this slug already exists')
      }
      throw error
    }
  }

  async update(productId: string, input: Partial<AdminProductInput>) {
    const update = { ...input } as Record<string, unknown>
    if (Object.hasOwn(update, 'imageUrl')) update.imageUrl = update.imageUrl || undefined
    try {
      const product = await Product.findByIdAndUpdate(productId, { $set: update }, {
        new: true,
        runValidators: true,
      })
      if (!product) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product not found')
      return product
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
        throw new HttpError(409, 'PRODUCT_SLUG_EXISTS', 'A product with this slug already exists')
      }
      throw error
    }
  }

  async addPrice(productId: string, input: { effectiveDate: string; pricePerKgPaise: number }, actorId: string) {
    if (!await Product.exists({ _id: productId })) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product not found')
    const effectiveFrom = hyderabadDayStart(input.effectiveDate)
    if (effectiveFrom.getTime() > Date.now() + 366 * 24 * 60 * 60 * 1000) {
      throw new HttpError(400, 'INVALID_EFFECTIVE_DATE', 'Effective date is too far in the future')
    }
    const latest = await DailyPrice.findOne({ productId }).sort({ effectiveFrom: -1 })
    if (latest && effectiveFrom.getTime() <= latest.effectiveFrom.getTime()) {
      throw new HttpError(409, 'PRICE_DATE_NOT_LATEST', 'Prices must be added after the latest recorded effective date')
    }

    const previous = await DailyPrice.findOne({
      productId,
      effectiveFrom: { $lt: effectiveFrom },
      $or: [{ effectiveTo: null }, { effectiveTo: { $gt: effectiveFrom } }],
    }).sort({ effectiveFrom: -1 })
    if (previous) {
      const closed = await DailyPrice.updateOne(
        { _id: previous._id, effectiveTo: previous.effectiveTo },
        { $set: { effectiveTo: effectiveFrom } },
      )
      if (closed.modifiedCount !== 1) throw new HttpError(409, 'PRICE_CHANGED', 'Price history changed; reload and retry')
    }

    try {
      return await DailyPrice.create({
        productId: new Types.ObjectId(productId),
        pricePerKgPaise: input.pricePerKgPaise,
        effectiveFrom,
        effectiveTo: null,
        changedById: new Types.ObjectId(actorId),
      })
    } catch (error) {
      if (previous) await DailyPrice.updateOne({ _id: previous._id, effectiveTo: effectiveFrom }, { $set: { effectiveTo: previous.effectiveTo ?? null } })
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
        throw new HttpError(409, 'PRICE_DATE_EXISTS', 'A price is already recorded for this effective date')
      }
      throw error
    }
  }

  async listPrices(productId: string, limit: number, offset: number) {
    if (!await Product.exists({ _id: productId })) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product not found')
    const [items, total] = await Promise.all([
      DailyPrice.find({ productId }).sort({ effectiveFrom: -1 }).skip(offset).limit(limit).lean(),
      DailyPrice.countDocuments({ productId }),
    ])
    return { items, total }
  }
}
