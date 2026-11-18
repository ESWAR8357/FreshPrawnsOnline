import { describe, expect, it } from 'vitest'
import { buildDeliveryAssignmentPayload, deliveryStatusLabel, toCustomerDelivery } from './delivery.js'

describe('delivery presentation and request helpers', () => {
  it('only exposes customer-appropriate shop delivery contact fields', () => {
    expect(toCustomerDelivery({
      method: 'shop',
      status: 'assigned',
      personName: 'Ravi',
      personPhone: '+919876543210',
      details: 'Admin-only instruction',
    }, 'third_party')).toEqual({
      method: 'shop',
      status: 'assigned',
      personName: 'Ravi',
      personPhone: '+919876543210',
    })
  })

  it('omits third-party internal details from customer tracking', () => {
    expect(toCustomerDelivery({
      method: 'third_party',
      status: 'in_transit',
      serviceName: 'Local courier',
      reference: 'LOCAL-123',
      details: 'Internal dispatch note',
      personPhone: '+919876543210',
    }, 'shop')).toEqual({
      method: 'third_party',
      status: 'in_transit',
      serviceName: 'Local courier',
      reference: 'LOCAL-123',
    })
  })

  it('builds method-specific assignment requests without irrelevant fields', () => {
    expect(buildDeliveryAssignmentPayload('shop', {
      personName: ' Ravi ',
      personPhone: ' +919876543210 ',
      serviceName: 'ignored',
      reference: 'ignored',
      details: 'ignored',
    })).toEqual({ method: 'shop', personName: 'Ravi', personPhone: '+919876543210' })
    expect(buildDeliveryAssignmentPayload('third_party', {
      personName: 'ignored',
      personPhone: 'ignored',
      serviceName: ' Local courier ',
      reference: ' REF-42 ',
      details: ' Leave at reception ',
    })).toEqual({
      method: 'third_party',
      serviceName: 'Local courier',
      reference: 'REF-42',
      details: 'Leave at reception',
    })
  })

  it('labels the current delivery state for tracking', () => {
    expect(deliveryStatusLabel('not_assigned')).toBe('Not assigned')
    expect(deliveryStatusLabel('exception')).toBe('Needs attention')
  })
})
