import { Types } from 'mongoose'
import { DailyPrice } from '../pricing/daily-price.model.js'
import { Stock } from '../inventory/stock.model.js'
import { Product } from './product.model.js'

export type CatalogueFilter = {
  size?: string
  preparation?: 'cleaned' | 'uncleaned'
}

export type CatalogueItem = {
  id: string
  slug: string
  name: string
  description: string
  longDescription: string
  size: string
  origin: string
  badge: string
  imageUrl: string | null
  active: boolean
  sampleData: boolean
  preparationOptions: Array<{
    type: 'cleaned' | 'uncleaned'
    enabled: boolean
    feePaise: number
  }>
  pricePerKgPaise: number | null
  priceEffectiveFrom: string | null
  stock: {
    onHandGrams: number
    availableGrams: number
  }
}

export interface CatalogueRepository {
  list(filter: CatalogueFilter, now: Date): Promise<CatalogueItem[]>
  findBySlug(slug: string, now: Date): Promise<CatalogueItem | null>
}

type LeanProduct = {
  _id: Types.ObjectId
  slug: string
  name: string
  description?: string
  longDescription?: string
  size: string
  origin?: string
  badge?: string
  imageUrl?: string
  active: boolean
  sampleData?: boolean
  preparationOptions?: CatalogueItem['preparationOptions']
}

export class MongoCatalogueRepository implements CatalogueRepository {
  async list(filter: CatalogueFilter, now: Date): Promise<CatalogueItem[]> {
    const productFilter: Record<string, unknown> = { active: true }
    if (filter.size) productFilter.size = filter.size
    if (filter.preparation) {
      productFilter.preparationOptions = {
        $elemMatch: { type: filter.preparation, enabled: true },
      }
    }

    const products = await Product.find(productFilter).sort({ name: 1 }).lean<LeanProduct[]>()
    return this.enrich(products, now)
  }

  async findBySlug(slug: string, now: Date): Promise<CatalogueItem | null> {
    const product = await Product.findOne({ slug, active: true }).lean<LeanProduct | null>()
    if (!product) return null
    const [item] = await this.enrich([product], now)
    return item ?? null
  }

  private async enrich(products: LeanProduct[], now: Date): Promise<CatalogueItem[]> {
    if (!products.length) return []

    const productIds = products.map(({ _id }) => _id)
    const [prices, stocks] = await Promise.all([
      DailyPrice.find({
        productId: { $in: productIds },
        effectiveFrom: { $lte: now },
        $or: [{ effectiveTo: null }, { effectiveTo: { $gt: now } }],
      }).sort({ effectiveFrom: -1 }).lean(),
      Stock.find({ productId: { $in: productIds } }).lean(),
    ])

    const currentPrices = new Map<string, { pricePerKgPaise: number; effectiveFrom: Date }>()
    for (const price of prices) {
      const key = price.productId.toString()
      if (!currentPrices.has(key)) {
        currentPrices.set(key, {
          pricePerKgPaise: price.pricePerKgPaise,
          effectiveFrom: price.effectiveFrom,
        })
      }
    }

    const stockByProduct = new Map(stocks.map((stock) => [stock.productId.toString(), stock]))

    return products.map((product) => {
      const key = product._id.toString()
      const price = currentPrices.get(key)
      const stock = stockByProduct.get(key)
      const onHandGrams = stock?.onHandGrams ?? 0
      const reservedGrams = stock?.reservedGrams ?? 0

      return {
        id: product.slug,
        slug: product.slug,
        name: product.name,
        description: product.description ?? '',
        longDescription: product.longDescription ?? '',
        size: product.size,
        origin: product.origin ?? 'Coastal catch',
        badge: product.badge ?? '',
        imageUrl: product.imageUrl ?? null,
        active: product.active,
        sampleData: product.sampleData ?? false,
        preparationOptions: product.preparationOptions ?? [],
        pricePerKgPaise: price?.pricePerKgPaise ?? null,
        priceEffectiveFrom: price?.effectiveFrom.toISOString() ?? null,
        stock: {
          onHandGrams,
          availableGrams: Math.max(0, onHandGrams - reservedGrams),
        },
      }
    })
  }
}
