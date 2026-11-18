import { SignJWT } from 'jose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import type { AdminCatalogueService } from '../src/modules/admin/catalogue.routes.js'
import type { AdminStockService } from '../src/modules/admin/stock.routes.js'
import type { AuthService, AuthUser } from '../src/modules/users/auth.service.js'

const config = loadConfig({
  MONGODB_URI: 'mongodb://localhost:27017/freshprawns?authSource=admin',
  JWT_ACCESS_SECRET: 'test-only-replace-with-random-secret-material',
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
})
const customer: AuthUser = { id: '507f1f77bcf86cd799439011', email: 'customer@example.test', role: 'customer' }
const admin: AuthUser = { id: '507f1f77bcf86cd799439012', email: 'admin@example.test', role: 'admin' }
const productId = '507f1f77bcf86cd799439013'

describe('admin catalogue and inventory APIs', () => {
  const catalogue: AdminCatalogueService = {
    list: vi.fn(async () => ({ items: [], total: 0 })),
    get: vi.fn(async () => ({ id: productId })),
    create: vi.fn(async (input) => ({ id: productId, ...input })),
    update: vi.fn(async (id, input) => ({ id, ...input })),
    addPrice: vi.fn(async (id, input, actorId) => ({ id, ...input, actorId })),
    listPrices: vi.fn(async () => ({ items: [], total: 0 })),
  }
  const stock: AdminStockService = {
    list: vi.fn(async () => ({ items: [], total: 0 })),
    movements: vi.fn(async () => ({ items: [], total: 0 })),
    adjust: vi.fn(async (id, actorId, input) => ({ id, actorId, ...input })),
  }
  const auth: AuthService = {
    register: vi.fn(),
    login: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    getActiveUser: vi.fn(async (id) => id === admin.id ? admin : id === customer.id ? customer : null),
  }
  const app = buildApp(config, undefined, undefined, { auth, adminCatalogue: catalogue, adminStock: stock })

  beforeEach(() => vi.clearAllMocks())

  async function bearer(user: AuthUser): Promise<string> {
    return new SignJWT({ role: user.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer('fresh-prawns-api')
      .setAudience('fresh-prawns-web')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(config.JWT_ACCESS_SECRET))
  }

  const validProduct = {
    slug: 'white-prawns',
    name: 'White Prawns',
    description: 'Medium prawns',
    longDescription: 'Fresh local sample description.',
    size: 'Medium',
    origin: 'Coastal catch',
    badge: '',
    imageUrl: 'https://example.test/white-prawns.jpg',
    active: true,
    preparationOptions: [
      { type: 'cleaned', enabled: true, feePaise: 4000 },
      { type: 'uncleaned', enabled: true, feePaise: 0 },
    ],
  }

  it('requires an admin for every catalogue, price, and stock write', async () => {
    const token = await bearer(customer)
    const writes = [
      request(app).post('/api/v1/admin/products').send(validProduct),
      request(app).patch(`/api/v1/admin/products/${productId}`).send({ active: false }),
      request(app).post(`/api/v1/admin/products/${productId}/prices`).send({ effectiveDate: '2026-11-19', pricePerKgPaise: 68000 }),
      request(app).post(`/api/v1/admin/stock/${productId}/adjustments`).send({
        idempotencyKey: 'b307034e-fba6-4d61-9a41-9b3978060f1c',
        deltaGrams: 500,
        reason: 'received',
      }),
    ]
    for (const responsePromise of writes) {
      const response = await responsePromise.set('Authorization', `Bearer ${token}`)
      expect(response.status).toBe(403)
    }
    expect(catalogue.create).not.toHaveBeenCalled()
    expect(catalogue.update).not.toHaveBeenCalled()
    expect(catalogue.addPrice).not.toHaveBeenCalled()
    expect(stock.adjust).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated admin reads and writes', async () => {
    expect((await request(app).get('/api/v1/admin/products')).status).toBe(401)
    expect((await request(app).post('/api/v1/admin/products').send(validProduct)).status).toBe(401)
    expect(catalogue.list).not.toHaveBeenCalled()
  })

  it('creates products from a strictly validated admin request', async () => {
    const token = await bearer(admin)
    const response = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${token}`)
      .send(validProduct)

    expect(response.status).toBe(201)
    expect(catalogue.create).toHaveBeenCalledWith(validProduct)
  })

  it.each([
    ['fractional price', { effectiveDate: '2026-11-19', pricePerKgPaise: 68000.5 }],
    ['invalid date', { effectiveDate: '19-11-2026', pricePerKgPaise: 68000 }],
    ['zero price', { effectiveDate: '2026-11-19', pricePerKgPaise: 0 }],
  ])('rejects %s before the pricing service', async (_label, body) => {
    const token = await bearer(admin)
    const response = await request(app)
      .post(`/api/v1/admin/products/${productId}/prices`)
      .set('Authorization', `Bearer ${token}`)
      .send(body)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_REQUEST')
    expect(catalogue.addPrice).not.toHaveBeenCalled()
  })

  it('records stock adjustments with actor and idempotency key', async () => {
    const token = await bearer(admin)
    const body = {
      idempotencyKey: 'b307034e-fba6-4d61-9a41-9b3978060f1c',
      deltaGrams: -250,
      reason: 'spoilage',
      reference: 'Daily quality check',
    }
    const response = await request(app)
      .post(`/api/v1/admin/stock/${productId}/adjustments`)
      .set('Authorization', `Bearer ${token}`)
      .send(body)

    expect(response.status).toBe(201)
    expect(stock.adjust).toHaveBeenCalledWith(productId, admin.id, body)
  })

  it('rejects unsafe stock adjustments', async () => {
    const token = await bearer(admin)
    const response = await request(app)
      .post(`/api/v1/admin/stock/${productId}/adjustments`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        idempotencyKey: 'b307034e-fba6-4d61-9a41-9b3978060f1c',
        deltaGrams: 0,
        reason: 'received',
      })

    expect(response.status).toBe(400)
    expect(stock.adjust).not.toHaveBeenCalled()
  })
})
