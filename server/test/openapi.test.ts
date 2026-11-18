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
