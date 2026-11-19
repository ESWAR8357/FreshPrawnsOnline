import { createRemoteJWKSet, errors, jwtVerify } from 'jose'
import { z } from 'zod'
import { HttpError } from '../../http-error.js'

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))
const emailSchema = z.string().email().max(254)

export async function verifyGoogleIdToken(credential: string, clientId: string) {
  let payload
  try {
    ({ payload } = await jwtVerify(credential, googleKeys, {
      audience: clientId,
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      algorithms: ['RS256'],
    }))
  } catch (error) {
    if (error instanceof errors.JOSEError && error.code !== 'ERR_JWKS_TIMEOUT') {
      throw new HttpError(401, 'INVALID_GOOGLE_CREDENTIAL', 'Google sign-in could not be verified')
    }
    throw new HttpError(503, 'GOOGLE_VERIFICATION_UNAVAILABLE', 'Google sign-in verification is temporarily unavailable')
  }

  const email = emailSchema.safeParse(payload.email)
  if (!payload.sub || typeof payload.sub !== 'string' || !email.success || payload.email_verified !== true) {
    throw new HttpError(401, 'INVALID_GOOGLE_CREDENTIAL', 'Google must provide a verified email address')
  }
  return { subject: payload.sub, email: email.data.toLowerCase() }
}
