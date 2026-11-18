import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { buildApp } from '../src/app.js'
import type { CatalogueItem, CatalogueRepository } from '../src/modules/products/catalogue.repository.js'
import { loadConfig } from '../src/config.js'

const config = loadConfig({
  MONGODB_URI: 'mongodb://localhost:27017/freshprawns?authSource=admin',
  NODE_ENV: 'test',
  JWT_ACCESS_SECRET: 'test-only-replace-with-random-secret-material',
  LOG_LEVEL: 'silent',
})

const product: CatalogueItem = {
  id: 'white-prawns',
  slug: 'white-prawns',
  name: 'White Prawns',
  description: 'Sweet and versatile.',
  longDescription: 'Fresh medium prawns.',
  size: 'Medium',
  origin: 'Coastal catch',
  badge: 'BESTSELLER',
  imageUrl: 'https://example.test/white-prawns.jpg',
  active: true,
  sampleData: true,
  preparationOptions: [
    { type: 'uncleaned', enabled: true, feePaise: 0 },
    { type: 'cleaned', enabled: true, feePaise: 4000 },
  ],
  pricePerKgPaise: 68000,
  priceEffectiveFrom: '2026-11-18T00:00:00.000Z',
  stock: { onHandGrams: 12500, availableGrams: 10000 },
}

describe('public product catalogue API', () => {
  const list = vi.fn< CatalogueRepository['list'] >()
  const findBySlug = vi.fn< CatalogueRepository['findBySlug']>()
  const repository: CatalogueRepository = { list, findBySlug }
  const app = buildApp(config, () => 'connected', repository)

  beforeEach(() => {
    vi.clearAllMocks()
    list.mockResolvedValue([product])
    findBySlug.mockResolvedValue(product)
  })

  it('returns active product details with current price, preparation options, and stock by weight', async () => {
    const response = await request(app).get('/api/v1/products')

    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body.data).toEqual([product])
    expect(response.body.data[0].stock.availableGrams).toBe(10000)
  })

  it('passes validated size and preparation filters to the repository', async () => {
    const response = await request(app)
      .get('/api/v1/products')
      .query({ size: 'Medium', preparation: 'cleaned' })

    expect(response.status).toBe(200)
    expect(list).toHaveBeenCalledWith(
      { size: 'Medium', preparation: 'cleaned' },
      expect.any(Date),
    )
  })

  it.each([
    ['unsupported size', { size: 'Extra Large' }],
    ['unsupported preparation', { preparation: 'peeled' }],
    ['unknown filter', { includeInactive: 'true' }],
  ])('rejects %s filters before querying data', async (_label, query) => {
    const response = await request(app).get('/api/v1/products').query(query)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_QUERY')
    expect(list).not.toHaveBeenCalled()
  })

  it('returns an active product by slug', async () => {
    const response = await request(app).get('/api/v1/products/white-prawns')

    expect(response.status).toBe(200)
    expect(response.body.data).toEqual(product)
    expect(findBySlug).toHaveBeenCalledWith('white-prawns', expect.any(Date))
  })

  it.each(['White Prawns', 'white--prawns', 'white_prawns', '../white-prawns'])(
    'rejects malformed product slug %s',
    async (slug) => {
      const response = await request(app).get(`/api/v1/products/${encodeURIComponent(slug)}`)

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('INVALID_PARAMETER')
      expect(findBySlug).not.toHaveBeenCalled()
    },
  )

  it('does not disclose inactive or missing products', async () => {
    findBySlug.mockResolvedValue(null)
    const response = await request(app).get('/api/v1/products/retired-prawns')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('PRODUCT_NOT_FOUND')
  })

  it('returns a service-unavailable response when MongoDB is not ready', async () => {
    const unavailableApp = buildApp(config, () => 'disconnected', repository)
    const response = await request(unavailableApp).get('/api/v1/products')

    expect(response.status).toBe(503)
    expect(response.body.error.code).toBe('DATABASE_NOT_READY')
    expect(list).not.toHaveBeenCalled()
  })
})
