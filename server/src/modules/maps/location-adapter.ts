export const locationLookupStatuses = ['found', 'ambiguous', 'not_found'] as const
export type LocationLookupStatus = typeof locationLookupStatuses[number]

export const locationPrecisions = ['approximate', 'street', 'building'] as const
export type LocationPrecision = typeof locationPrecisions[number]

export interface GeocodeAddress {
  line: string
  locality: string
  city: string
  postalCode?: string
}

export interface GeocodeRequest {
  address: GeocodeAddress
}

export interface LocationCoordinates {
  latitude: number
  longitude: number
}

export interface GeocodeResult {
  status: LocationLookupStatus
  coordinates?: LocationCoordinates
  precision?: LocationPrecision
}

export type LocationAdapterErrorCode =
  | 'unavailable'
  | 'invalid_request'
  | 'not_supported'
  | 'invalid_response'

export class LocationAdapterError extends Error {
  constructor(
    readonly code: LocationAdapterErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'LocationAdapterError'
  }
}

export interface LocationAdapter {
  geocodeAddress(request: GeocodeRequest): Promise<GeocodeResult>
}
