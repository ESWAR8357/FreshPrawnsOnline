import { Router } from 'express'
import type { RequestHandler, Response } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { HttpError } from '../../http-error.js'
import type { ServerConfig } from '../../config.js'
import type { AuthService } from './auth.service.js'
import { requireAdmin } from './auth.middleware.js'
import { verifyGoogleIdToken } from './google-id-token.js'

const credentialsSchema = z.object({
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
  password: z.string().min(12).max(128),
}).strict()
const googleCredentialSchema = z.object({ credential: z.string().min(1).max(8192) }).strict()

const cookieName = 'freshprawns_refresh'
const credentialRateLimit = rateLimit({
  windowMs: 900000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Try again later.' } })
  },
})

function getRefreshToken(cookieHeader: string | undefined): string | null {
  const entry = cookieHeader?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
  if (!entry) return null
  try {
    return decodeURIComponent(entry.slice(cookieName.length + 1)) || null
  } catch {
    return null
  }
}

function setRefreshCookie(response: Response, config: ServerConfig, token: string | null) {
  const attributes = [
    `${cookieName}=${token ? encodeURIComponent(token) : ''}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/api/v1/auth',
    `Max-Age=${token ? config.REFRESH_TOKEN_TTL_DAYS * 86400 : 0}`,
  ]
  if (config.NODE_ENV === 'production') attributes.push('Secure')
  response.setHeader('Set-Cookie', attributes.join('; '))
}

function validationError(response: Response, error: z.ZodError) {
  response.status(400).json({
    error: {
      code: 'INVALID_REQUEST',
      message: 'Request data is invalid',
      issues: error.issues.map(({ path, message }) => ({ path, message })),
    },
  })
}

export function createAuthRouter(service: AuthService, config: ServerConfig, authenticate: RequestHandler): Router {
  const router = Router()
  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store')
    next()
  })

  for (const [path, action] of [['register', 'register'], ['login', 'login']] as const) {
    router.post(`/${path}`, credentialRateLimit, async (request, response, next) => {
      const parsed = credentialsSchema.safeParse(request.body)
      if (!parsed.success) {
        validationError(response, parsed.error)
        return
      }
      try {
        const tokens = action === 'register'
          ? await service.register(parsed.data.email, parsed.data.password)
          : await service.login(parsed.data.email, parsed.data.password)
        setRefreshCookie(response, config, tokens.refreshToken)
        response.status(action === 'register' ? 201 : 200).json({
          data: { user: tokens.user, accessToken: tokens.accessToken, expiresIn: config.JWT_ACCESS_TTL_SECONDS },
        })
      } catch (error) {
        next(error)
      }
    })
  }

  router.post('/google', credentialRateLimit, async (request, response, next) => {
    if (!config.GOOGLE_CLIENT_ID) {
      response.status(503).json({ error: { code: 'GOOGLE_SIGNIN_NOT_CONFIGURED', message: 'Google sign-in is not configured yet' } })
      return
    }
    if (!service.loginWithGoogle) {
      response.status(503).json({ error: { code: 'GOOGLE_SIGNIN_UNAVAILABLE', message: 'Google sign-in is unavailable' } })
      return
    }
    const parsed = googleCredentialSchema.safeParse(request.body)
    if (!parsed.success) {
      validationError(response, parsed.error)
      return
    }
    try {
      const identity = await verifyGoogleIdToken(parsed.data.credential, config.GOOGLE_CLIENT_ID)
      const tokens = await service.loginWithGoogle(identity.subject, identity.email)
      setRefreshCookie(response, config, tokens.refreshToken)
      response.json({
        data: { user: tokens.user, accessToken: tokens.accessToken, expiresIn: config.JWT_ACCESS_TTL_SECONDS },
      })
    } catch (error) {
      next(error)
    }
  })

  router.post('/refresh', async (request, response, next) => {
    const origin = request.header('origin')
    if (origin && !config.corsOrigins.includes(origin)) {
      response.status(403).json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Request origin is not allowed' } })
      return
    }
    const token = getRefreshToken(request.headers.cookie)
    if (!token) {
      response.status(401).json({ error: { code: 'INVALID_REFRESH_TOKEN', message: 'Sign in to continue' } })
      return
    }
    try {
      const tokens = await service.refresh(token)
      setRefreshCookie(response, config, tokens.refreshToken)
      response.json({ data: { user: tokens.user, accessToken: tokens.accessToken, expiresIn: config.JWT_ACCESS_TTL_SECONDS } })
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) setRefreshCookie(response, config, null)
      next(error)
    }
  })

  router.post('/logout', async (request, response, next) => {
    const origin = request.header('origin')
    if (origin && !config.corsOrigins.includes(origin)) {
      response.status(403).json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Request origin is not allowed' } })
      return
    }
    try {
      await service.logout(getRefreshToken(request.headers.cookie))
      setRefreshCookie(response, config, null)
      response.status(204).end()
    } catch (error) {
      next(error)
    }
  })

  router.get('/me', authenticate, async (request, response, next) => {
    if (!request.authUser) {
      next(new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to continue'))
      return
    }
    response.json({ data: { user: request.authUser } })
  })

  router.get('/admin-check', authenticate, requireAdmin, (_request, response) => {
    response.json({ data: { authorized: true } })
  })
  return router
}
