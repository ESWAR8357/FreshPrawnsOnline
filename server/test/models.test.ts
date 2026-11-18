import { describe, expect, it } from 'vitest'
import { DailyPrice } from '../src/modules/pricing/daily-price.model.js'
import { Product } from '../src/modules/products/product.model.js'
import { Stock } from '../src/modules/inventory/stock.model.js'
import { Order } from '../src/modules/orders/order.model.js'
import { RefreshSession } from '../src/modules/users/refresh-session.model.js'
import { User } from '../src/modules/users/user.model.js'

describe('foundation model validation and indexes', () => {
  it('normalizes user email and restricts user roles', () => {
    const user = new User({ email: ' OWNER@EXAMPLE.TEST ', passwordHash: 'hash', role: 'owner' })
    const error = user.validateSync()

    expect(user.email).toBe('owner@example.test')
    expect(error?.errors.role).toBeDefined()
    expect(User.schema.indexes()).toContainEqual([{ email: 1 }, { unique: true, background: true }])
  })

  it('requires a valid product slug and defines catalogue indexes', () => {
    const product = new Product({ name: 'White Prawns', size: 'Medium' })

    expect(product.validateSync()?.errors.slug).toBeDefined()
    expect(Product.schema.indexes()).toContainEqual([{ active: 1, size: 1 }, { background: true }])
  })

  it('rejects malformed slugs and unsupported product sizes', () => {
    const product = new Product({
      slug: 'White_Prawns',
      name: 'White Prawns',
      size: 'Extra Large',
    })
    const errors = product.validateSync()?.errors

    expect(errors?.slug).toBeDefined()
    expect(errors?.size).toBeDefined()
  })

  it('validates enabled cleaned and uncleaned preparation options and safe image URLs', () => {
    const product = new Product({
      slug: 'white-prawns',
      name: 'White Prawns',
      size: 'Medium',
      imageUrl: 'http://example.test/prawns.jpg',
      preparationOptions: [
        { type: 'cleaned', enabled: true, feePaise: 10.5 },
        { type: 'uncleaned', enabled: true, feePaise: 0 },
      ],
    })
    const errors = product.validateSync()?.errors

    expect(errors?.imageUrl).toBeDefined()
    expect(errors?.['preparationOptions.0.feePaise']).toBeDefined()
  })

  it('enforces integer weights and non-negative stock', () => {
    const stock = new Stock({ productId: '507f1f77bcf86cd799439011', onHandGrams: 2.5, reservedGrams: -1 })
    const errors = stock.validateSync()?.errors

    expect(errors?.onHandGrams).toBeDefined()
    expect(errors?.reservedGrams).toBeDefined()
  })

  it('does not allow reserved weight to exceed on-hand stock', () => {
    const stock = new Stock({ productId: '507f1f77bcf86cd799439011', onHandGrams: 1000, reservedGrams: 1500 })

    expect(stock.validateSync()?.errors.reservedGrams).toBeDefined()
  })

  it('stores stock reservation ownership with integer gram quantities', () => {
    const stock = new Stock({
      productId: '507f1f77bcf86cd799439011',
      onHandGrams: 1000,
      reservedGrams: 500,
      reservations: [{ orderId: '507f1f77bcf86cd799439012', grams: 500.5 }],
    })

    expect(stock.validateSync()?.errors['reservations.0.grams']).toBeDefined()
    expect(Stock.schema.indexes()).toContainEqual([{ 'reservations.orderId': 1 }, { background: true }])
  })

  it('stores idempotent stock movements in the stock document', () => {
    const stock = new Stock({
      productId: '507f1f77bcf86cd799439011',
      onHandGrams: 1000,
      reservedGrams: 500,
      movements: [{
        operationId: 'admin:adjustment-key',
        actorId: '507f1f77bcf86cd799439012',
        deltaGrams: -250,
        reservedDeltaGrams: 0,
        reason: 'spoilage',
        createdAt: new Date(),
      }],
    })
    expect(stock.validateSync()).toBeUndefined()
    expect(stock.movements[0].operationId).toBe('admin:adjustment-key')
  })

  it('stores prices as integer paise', () => {
    const price = new DailyPrice({
      productId: '507f1f77bcf86cd799439011',
      pricePerKgPaise: 123.5,
      effectiveFrom: new Date(),
    })

    expect(price.validateSync()?.errors.pricePerKgPaise).toBeDefined()
  })

  it('hides refresh-token hashes and expires refresh sessions by TTL', () => {
    expect(RefreshSession.schema.path('tokenHash')?.options.select).toBe(false)
    expect(RefreshSession.schema.indexes()).toContainEqual([
      { expiresAt: 1 },
      { expireAfterSeconds: 0, background: true },
    ])
  })

  it('requires customer ownership and durable reservation state for orders', () => {
    const order = new Order({
      customerName: 'Ananya Rao',
      customerPhone: '+919876543210',
      address: { line: '12 Lake View Road', locality: 'Banjara Hills', city: 'Hyderabad', postalCode: '500034' },
      deliveryMethod: 'shop',
      items: [],
      subtotalPaise: 0,
      deliveryFeePaise: 4000,
      totalPaise: 4000,
      idempotencyKey: 'key',
      requestFingerprint: 'fingerprint',
    })
    const errors = order.validateSync()?.errors

    expect(errors?.customerUserId).toBeDefined()
    expect(Order.schema.path('stockReservationState')?.options.enum).toContain('reserving')
  })

  it('stores append-only order events with constrained event types and actors', () => {
    const order = new Order({
      customerUserId: '507f1f77bcf86cd799439011',
      customerName: 'Ananya Rao',
      customerPhone: '+919876543210',
      address: { line: '12 Lake View Road', locality: 'Banjara Hills', city: 'Hyderabad', postalCode: '500034' },
      deliveryMethod: 'shop',
      items: [{ productId: '507f1f77bcf86cd799439013', productName: 'White Prawns', preparation: 'cleaned', weightGrams: 500, quantity: 1, pricePerKgPaise: 68000, preparationFeePaise: 0, lineTotalPaise: 34000 }],
      subtotalPaise: 34000,
      deliveryFeePaise: 4000,
      totalPaise: 38000,
      idempotencyKey: 'key',
      requestFingerprint: 'fingerprint',
      events: [{ type: 'order_status_changed', actorRole: 'admin', from: 'pending', to: 'confirmed' }],
    })
    expect(order.validateSync()).toBeUndefined()
    expect(order.events[0].type).toBe('order_status_changed')
  })
})
