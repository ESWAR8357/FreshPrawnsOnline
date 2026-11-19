import { describe, expect, it } from 'vitest'
import {
  LocationAdapterError,
  locationLookupStatuses,
  locationPrecisions,
  type GeocodeRequest,
  type GeocodeResult,
  type LocationAdapter,
} from '../src/modules/maps/location-adapter.js'

class FakeLocationAdapter implements LocationAdapter {
  readonly lookups: GeocodeRequest[] = []

  async geocodeAddress(request: GeocodeRequest): Promise<GeocodeResult> {
    this.lookups.push(request)
    const { line, locality, city, postalCode } = request.address
    if (![line, locality, city].every((part) => part.trim())) {
      throw new LocationAdapterError('invalid_request', 'Address fields are required', false)
    }

    if (city === 'Test City' && locality === 'Sample Locality' && postalCode === '000001') {
      return {
        status: 'found',
        coordinates: { latitude: 0.1234, longitude: 0.5678 },
        precision: 'approximate',
      }
    }
    if (city === 'Test City' && locality === 'Ambiguous Locality') {
      return { status: 'ambiguous' }
    }
    return { status: 'not_found' }
  }
}

describe('provider-independent location adapter contract', () => {
  it('exposes normalized lookup statuses and precision levels', () => {
    expect(locationLookupStatuses).toEqual(['found', 'ambiguous', 'not_found'])
    expect(locationPrecisions).toEqual(['approximate', 'street', 'building'])
  })

  it('returns deterministic synthetic geocode results without external lookup', async () => {
    const adapter = new FakeLocationAdapter()
    const request = {
      address: {
        line: '1 Example Street',
        locality: 'Sample Locality',
        city: 'Test City',
        postalCode: '000001',
      },
    }

    await expect(adapter.geocodeAddress(request)).resolves.toEqual({
      status: 'found',
      coordinates: { latitude: 0.1234, longitude: 0.5678 },
      precision: 'approximate',
    })
    expect(adapter.lookups).toEqual([request])
  })

  it('normalizes ambiguous and missing lookup results without coordinates', async () => {
    const adapter = new FakeLocationAdapter()
    await expect(adapter.geocodeAddress({
      address: { line: '1 Example Street', locality: 'Ambiguous Locality', city: 'Test City' },
    })).resolves.toEqual({ status: 'ambiguous' })
    await expect(adapter.geocodeAddress({
      address: { line: '9 Unknown Road', locality: 'Unknown', city: 'Test City' },
    })).resolves.toEqual({ status: 'not_found' })
  })

  it('rejects incomplete address input with a provider-neutral error', async () => {
    const adapter = new FakeLocationAdapter()
    await expect(adapter.geocodeAddress({
      address: { line: ' ', locality: 'Sample Locality', city: 'Test City' },
    })).rejects.toMatchObject({
      name: 'LocationAdapterError',
      code: 'invalid_request',
      retryable: false,
    })
    expect(adapter.lookups).toHaveLength(1)
  })
})
