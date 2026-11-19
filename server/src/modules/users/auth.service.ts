import { createHash, randomBytes, randomUUID } from 'node:crypto'
import argon2 from 'argon2'
import { SignJWT } from 'jose'
import { HttpError } from '../../http-error.js'
import { RefreshSession } from './refresh-session.model.js'
import { User } from './user.model.js'

export type AuthUser = {
  id: string
  email: string
  role: 'customer' | 'admin'
}

export type AuthTokens = {
  user: AuthUser
  accessToken: string
  refreshToken: string
}

export type AuthServiceConfig = {
  accessSecret: string
  accessTtlSeconds: number
  refreshTtlDays: number
}

export interface AuthService {
  register(email: string, password: string): Promise<AuthTokens>
  login(email: string, password: string): Promise<AuthTokens>
  loginWithGoogle?(subject: string, email: string): Promise<AuthTokens>
  refresh(refreshToken: string): Promise<AuthTokens>
  logout(refreshToken: string | null): Promise<void>
  getActiveUser(id: string): Promise<AuthUser | null>
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function toAuthUser(user: { _id: { toString(): string }; email: string; role: 'customer' | 'admin' }): AuthUser {
  return { id: user._id.toString(), email: user.email, role: user.role }
}

export class MongoAuthService implements AuthService {
  private readonly signingKey: Uint8Array

  constructor(private readonly config: AuthServiceConfig) {
    this.signingKey = new TextEncoder().encode(config.accessSecret)
  }

  async register(email: string, password: string): Promise<AuthTokens> {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id })
    let user
    try {
      user = await User.create({ email, passwordHash, role: 'customer' })
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
        throw new HttpError(409, 'EMAIL_ALREADY_REGISTERED', 'An account with this email already exists')
      }
      throw error
    }
    return this.issueTokens(toAuthUser(user), randomUUID())
  }

  async login(email: string, password: string): Promise<AuthTokens> {
    const user = await User.findOne({ email }).select('+passwordHash')
    if (!user || user.status !== 'active' || !user.passwordHash || !await argon2.verify(user.passwordHash, password)) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect')
    }
    return this.issueTokens(toAuthUser(user), randomUUID())
  }

  async loginWithGoogle(subject: string, email: string): Promise<AuthTokens> {
    let user = await User.findOne({ googleSubject: subject })
    if (!user) {
      user = await User.findOne({ email }).select('+googleSubject')
      if (user) {
        if (user.status !== 'active') throw new HttpError(403, 'ACCOUNT_UNAVAILABLE', 'This account is unavailable')
        if (user.googleSubject && user.googleSubject !== subject) {
          throw new HttpError(409, 'GOOGLE_ACCOUNT_MISMATCH', 'This email is linked to a different Google account')
        }
        user.googleSubject = subject
        try {
          await user.save()
        } catch (error) {
          if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 11000)) throw error
          user = await User.findOne({ googleSubject: subject })
        }
      } else {
        try {
          user = await User.create({ email, googleSubject: subject, role: 'customer' })
        } catch (error) {
          if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 11000)) throw error
          user = await User.findOne({ googleSubject: subject })
        }
      }
    }
    if (!user || user.status !== 'active') {
      throw new HttpError(401, 'GOOGLE_ACCOUNT_UNAVAILABLE', 'This Google account could not be signed in')
    }
    return this.issueTokens(toAuthUser(user), randomUUID())
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const tokenHash = hashToken(refreshToken)
    const session = await RefreshSession.findOne({ tokenHash }).select('+tokenHash')
    if (!session) throw new HttpError(401, 'INVALID_REFRESH_TOKEN', 'Refresh session is invalid or expired')
    if (session.revokedAt) {
      await RefreshSession.updateMany({ familyId: session.familyId, revokedAt: null }, { revokedAt: new Date() })
      throw new HttpError(401, 'REFRESH_TOKEN_REUSED', 'Refresh session is no longer valid')
    }
    if (session.expiresAt <= new Date()) {
      session.revokedAt = new Date()
      await session.save()
      throw new HttpError(401, 'INVALID_REFRESH_TOKEN', 'Refresh session is invalid or expired')
    }

    const user = await this.getActiveUser(session.userId.toString())
    if (!user) {
      await RefreshSession.updateMany({ familyId: session.familyId, revokedAt: null }, { revokedAt: new Date() })
      throw new HttpError(401, 'ACCOUNT_UNAVAILABLE', 'This account is unavailable')
    }

    const now = new Date()
    const rotated = await RefreshSession.updateOne(
      { _id: session._id, revokedAt: null, expiresAt: { $gt: now } },
      { $set: { revokedAt: now } },
    )
    if (rotated.modifiedCount !== 1) {
      const current = await RefreshSession.findById(session._id)
      if (current?.revokedAt) {
        await RefreshSession.updateMany({ familyId: session.familyId, revokedAt: null }, { revokedAt: new Date() })
        throw new HttpError(401, 'REFRESH_TOKEN_REUSED', 'Refresh session is no longer valid')
      }
      throw new HttpError(401, 'INVALID_REFRESH_TOKEN', 'Refresh session is invalid or expired')
    }
    return this.issueTokens(user, session.familyId)
  }

  async logout(refreshToken: string | null): Promise<void> {
    if (!refreshToken) return
    await RefreshSession.updateOne(
      { tokenHash: hashToken(refreshToken), revokedAt: null },
      { revokedAt: new Date() },
    )
  }

  async getActiveUser(id: string): Promise<AuthUser | null> {
    const user = await User.findOne({ _id: id, status: 'active' }).select('_id email role')
    return user ? toAuthUser(user) : null
  }

  private async issueTokens(user: AuthUser, familyId: string): Promise<AuthTokens> {
    const now = Math.floor(Date.now() / 1000)
    const accessToken = await new SignJWT({ role: user.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer('fresh-prawns-api')
      .setAudience('fresh-prawns-web')
      .setIssuedAt(now)
      .setExpirationTime(now + this.config.accessTtlSeconds)
      .sign(this.signingKey)
    const refreshToken = randomBytes(48).toString('base64url')
    const expiresAt = new Date(Date.now() + this.config.refreshTtlDays * 86400000)
    await RefreshSession.create({
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      familyId,
      expiresAt,
    })
    return { user, accessToken, refreshToken }
  }
}
