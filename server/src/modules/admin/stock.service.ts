import { Types } from 'mongoose'
import { HttpError } from '../../http-error.js'
import { Product } from '../products/product.model.js'
import { Stock } from '../inventory/stock.model.js'
import type { AdminStockService } from './stock.routes.js'

export class MongoAdminStockService implements AdminStockService {
  async list(limit: number, offset: number) {
    const [products, total] = await Promise.all([
      Product.find().sort({ name: 1, _id: 1 }).skip(offset).limit(limit).select('name slug active').lean(),
      Product.countDocuments(),
    ])
    const stocks = await Stock.find({ productId: { $in: products.map(({ _id }) => _id) } }).lean()
    const stockByProduct = new Map(stocks.map((stock) => [stock.productId.toString(), stock]))
    return {
      items: products.map((product) => {
        const stock = stockByProduct.get(product._id.toString())
        const onHandGrams = stock?.onHandGrams ?? 0
        const reservedGrams = stock?.reservedGrams ?? 0
        return {
          product,
          onHandGrams,
          reservedGrams,
          availableGrams: Math.max(0, onHandGrams - reservedGrams),
        }
      }),
      total,
    }
  }

  async movements(productId: string, limit: number, offset: number) {
    if (!await Product.exists({ _id: productId })) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product not found')
    const stock = await Stock.findOne({ productId }).lean()
    const movements = (stock?.movements ?? []).slice().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    return { items: movements.slice(offset, offset + limit), total: movements.length }
  }

  async adjust(productId: string, actorId: string, input: {
    idempotencyKey: string
    deltaGrams: number
    reason: 'received' | 'spoilage' | 'correction' | 'other'
    reference?: string
  }) {
    if (!await Product.exists({ _id: productId })) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product not found')
    let stock = await Stock.findOne({ productId })
    if (!stock) {
      try {
        stock = await Stock.create({ productId: new Types.ObjectId(productId), onHandGrams: 0, reservedGrams: 0 })
      } catch (error) {
        if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 11000)) throw error
        stock = await Stock.findOne({ productId })
      }
      if (!stock) throw new HttpError(409, 'STOCK_INITIALIZATION_FAILED', 'Stock could not be initialized; retry the adjustment')
    }
    const operationId = `${actorId}:${input.idempotencyKey}`
    const existing = stock.movements.find((entry) => entry.operationId === operationId)
    if (existing) return existing
    const query: Record<string, unknown> = {
      _id: stock._id,
      'movements.operationId': { $ne: operationId },
    }
    query.$expr = {
      $and: [
        { $gte: [{ $add: ['$onHandGrams', input.deltaGrams] }, '$reservedGrams'] },
        { $gte: [{ $add: ['$onHandGrams', input.deltaGrams] }, 0] },
        { $lte: [{ $add: ['$onHandGrams', input.deltaGrams] }, 1_000_000_000] },
      ],
    }
    const movement = {
      operationId,
      actorId: new Types.ObjectId(actorId),
      deltaGrams: input.deltaGrams,
      reservedDeltaGrams: 0,
      reason: input.reason,
      ...(input.reference ? { reference: input.reference } : {}),
      createdAt: new Date(),
    }
    const updated = await Stock.findOneAndUpdate(
      query,
      { $inc: { onHandGrams: input.deltaGrams }, $push: { movements: movement } },
      { new: true, runValidators: true },
    )
    if (!updated) {
      const latest = await Stock.findById(stock._id)
      const retry = latest?.movements.find((entry) => entry.operationId === operationId)
      if (retry) return retry
      if (input.deltaGrams > 0) throw new HttpError(409, 'STOCK_LIMIT_EXCEEDED', 'Stock exceeds the supported quantity limit')
      throw new HttpError(409, 'INSUFFICIENT_AVAILABLE_STOCK', 'Adjustment cannot reduce stock below the reserved quantity')
    }
    return updated.movements[updated.movements.length - 1]
  }
}
