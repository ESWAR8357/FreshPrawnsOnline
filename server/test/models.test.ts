import { describe, expect, it } from 'vitest'
import { DailyPrice } from '../src/modules/pricing/daily-price.model.js'
import { Product } from '../src/modules/products/product.model.js'
import { Stock } from '../src/modules/inventory/stock.model.js'
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

  it('enforces integer weights and non-negative stock', () => {
    const stock = new Stock({ productId: '507f1f77bcf86cd799439011', onHandGrams: 2.5, reservedGrams: -1 })
    const errors = stock.validateSync()?.errors

    expect(errors?.onHandGrams).toBeDefined()
    expect(errors?.reservedGrams).toBeDefined()
  })

  it('stores prices as integer paise', () => {
    const price = new DailyPrice({
      productId: '507f1f77bcf86cd799439011',
      pricePerKgPaise: 123.5,
      effectiveFrom: new Date(),
    })

    expect(price.validateSync()?.errors.pricePerKgPaise).toBeDefined()
  })
})
