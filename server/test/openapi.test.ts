import { describe, expect, it } from 'vitest'
import { openApiSpec } from '../src/openapi/spec.js'

describe('OpenAPI delivery assignment contract', () => {
  it('documents delivery write routes as top-level, admin-authenticated paths', () => {
    expect(openApiSpec.paths['/api/v1/orders/{id}/delivery'].patch.security).toEqual([{ bearerAuth: [] }])
    expect(openApiSpec.paths['/api/v1/orders/{id}/delivery/status'].patch.security).toEqual([{ bearerAuth: [] }])
  })

  it('documents both supported assignment methods and excludes extra request fields', () => {
    const assignment = openApiSpec.components.schemas.DeliveryAssignment
    expect(assignment.oneOf.map((variant) => variant.properties.method.const)).toEqual(['shop', 'third_party'])
    expect(assignment.oneOf.every((variant) => variant.additionalProperties === false)).toBe(true)
  })
})

describe('OpenAPI Phase 6 admin and order history contract', () => {
  it('documents admin product, price, and stock routes with authentication', () => {
    const adminPaths = [
      '/api/v1/admin/products',
      '/api/v1/admin/products/{productId}',
      '/api/v1/admin/products/{productId}/prices',
      '/api/v1/admin/stock',
      '/api/v1/admin/stock/{productId}/adjustments',
      '/api/v1/admin/stock/{productId}/movements',
    ]
    for (const path of adminPaths) {
      const operations = Object.values(openApiSpec.paths[path])
      expect(operations.length).toBeGreaterThan(0)
      for (const operation of operations) {
        expect(operation.security).toEqual([{ bearerAuth: [] }])
      }
    }
  })

  it('documents a customer-authenticated order event history route', () => {
    expect(openApiSpec.paths['/api/v1/orders/{id}/events'].get.security).toEqual([{ bearerAuth: [] }])
  })
})
