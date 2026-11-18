import type { NextFunction, Request, Response } from 'express'
import { jwtVerify } from 'jose'
import type { AuthUser, AuthService } from './auth.service.js'

declare module 'express-serve-static-core' {
  interface Request {
    authUser?: AuthUser
  }
}

export function createAuthenticationMiddleware(secret: string, authService: AuthService) {
  const key = new TextEncoder().encode(secret)
  return async (request: Request, response: Response, next: NextFunction) => {
    const authorization = request.header('authorization')
    if (!authorization?.startsWith('Bearer ')) {
      response.status(401).json({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'Sign in to continue' } })
      return
    }

    let subject: string
    try {
      const { payload } = await jwtVerify(authorization.slice(7), key, {
        algorithms: ['HS256'],
        issuer: 'fresh-prawns-api',
        audience: 'fresh-prawns-web',
      })
      if (typeof payload.sub !== 'string') throw new Error('Missing token subject')
      subject = payload.sub
    } catch {
      response.status(401).json({ error: { code: 'INVALID_ACCESS_TOKEN', message: 'Sign in to continue' } })
      return
    }

    const user = await authService.getActiveUser(subject)
    if (!user) {
      response.status(401).json({ error: { code: 'ACCOUNT_UNAVAILABLE', message: 'This account is unavailable' } })
      return
    }
    request.authUser = user
    next()
  }
}

export function requireAdmin(request: Request, response: Response, next: NextFunction): void {
  if (request.authUser?.role !== 'admin') {
    response.status(request.authUser ? 403 : 401).json({
      error: {
        code: request.authUser ? 'ADMIN_ACCESS_REQUIRED' : 'AUTHENTICATION_REQUIRED',
        message: request.authUser ? 'Administrator access is required' : 'Sign in to continue',
      },
    })
    return
  }
  next()
}
