import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express, { type ErrorRequestHandler } from 'express'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import pino from 'pino'
import type { ServerConfig } from './config.js'
import { getDatabaseState } from './database.js'
import { createHealthRouter } from './modules/health/health.routes.js'
import { MongoCatalogueRepository, type CatalogueRepository } from './modules/products/catalogue.repository.js'
import { createProductsRouter } from './modules/products/products.routes.js'
import { createAuthRouter } from './modules/users/auth.routes.js'
import { createAuthenticationMiddleware } from './modules/users/auth.middleware.js'
import { MongoAuthService, type AuthService } from './modules/users/auth.service.js'
import { createOrdersRouter } from './modules/orders/orders.routes.js'
import { MongoOrdersService, type OrdersService } from './modules/orders/orders.service.js'
import { HttpError } from './http-error.js'
import { openApiSpec } from './openapi/spec.js'
import { createAdminCatalogueRouter, type AdminCatalogueService } from './modules/admin/catalogue.routes.js'
import { createAdminStockRouter, type AdminStockService } from './modules/admin/stock.routes.js'

type AppServices = {
  auth?: AuthService
  orders?: OrdersService
  adminCatalogue?: AdminCatalogueService
  adminStock?: AdminStockService
}

export function buildApp(
  config: ServerConfig,
  readDatabaseState: () => ReturnType<typeof getDatabaseState> = getDatabaseState,
  catalogueRepository: CatalogueRepository = new MongoCatalogueRepository(),
  services: AppServices = {},
  frontendDistPath?: string,
) {
  const app = express()
  app.set('trust proxy', 1)
  const logger = pino({
    level: config.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
  })

  app.disable('x-powered-by')
  app.use((request, response, next) => {
    const requestId = request.headers['x-request-id']
    const id = typeof requestId === 'string' && /^[\w.-]{1,100}$/.test(requestId)
      ? requestId
      : randomUUID()
    const startedAt = Date.now()
    response.setHeader('X-Request-Id', id)
    response.on('finish', () => {
      const log = {
        requestId: id,
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        responseTimeMs: Date.now() - startedAt,
      }
      if (response.statusCode >= 500) logger.error(log, 'request failed')
      else if (response.statusCode >= 400) logger.warn(log, 'request rejected')
      else logger.info(log, 'request completed')
    })
    next()
  })
  app.use(helmet())
  app.use(cors({
    origin: (origin, callback) => callback(null, !origin || config.corsOrigins.includes(origin)),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    credentials: true,
  }))
  app.use(rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    limit: config.RATE_LIMIT_MAX,
    // Render polls /health every few seconds. Keep those probes out of the
    // customer request budget so the service does not mark itself unhealthy.
    skip: (request) => request.path === '/health' || request.path.startsWith('/health/'),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_request, response) => {
      response.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } })
    },
  }))
  app.use(express.json({ limit: '32kb', strict: true }))

  app.use('/health', createHealthRouter(readDatabaseState))
  app.use('/api/v1/products', createProductsRouter(readDatabaseState, catalogueRepository))
  const authService = services.auth ?? new MongoAuthService({
    accessSecret: config.JWT_ACCESS_SECRET,
    accessTtlSeconds: config.JWT_ACCESS_TTL_SECONDS,
    refreshTtlDays: config.REFRESH_TOKEN_TTL_DAYS,
  })
  const authenticate = createAuthenticationMiddleware(config.JWT_ACCESS_SECRET, authService)
  app.use('/api/v1/auth', rateLimit({
    windowMs: 900000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  }), createAuthRouter(authService, config, authenticate))
  app.use('/api/v1/orders', createOrdersRouter(services.orders ?? new MongoOrdersService(), authenticate))
  app.use('/api/v1/admin', createAdminCatalogueRouter(authenticate, services.adminCatalogue))
  app.use('/api/v1/admin/stock', createAdminStockRouter(authenticate, services.adminStock))
  app.get('/openapi.json', (_request, response) => response.json(openApiSpec))

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } })
  })

  const frontendDist = frontendDistPath
    ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'dist')
  if (existsSync(frontendDist)) {
    app.use(express.static(frontendDist))
    app.get('/{*splat}', (_request, response) => {
      response.sendFile(resolve(frontendDist, 'index.html'))
    })
  }

  const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, next) => {
    if (response.headersSent) return next(error)
    if (error instanceof HttpError) {
      response.status(error.status).json({ error: { code: error.code, message: error.message } })
      return
    }
    const candidateStatus = typeof error === 'object' && error !== null && 'status' in error
      ? Number(error.status)
      : 500
    const statusCode = Number.isInteger(candidateStatus) && candidateStatus >= 400 && candidateStatus < 500
      ? candidateStatus
      : error instanceof SyntaxError && 'body' in error ? 400 : 500
    if (statusCode >= 500) logger.error({ statusCode }, 'request failed with an unexpected error')
    response.status(statusCode).json({
      error: {
        code: statusCode === 400 ? 'INVALID_JSON' : statusCode === 413 ? 'PAYLOAD_TOO_LARGE' : 'INTERNAL_SERVER_ERROR',
        message: statusCode === 400
          ? 'Request body must be valid JSON'
          : statusCode === 413
            ? 'Request body is too large'
            : 'An unexpected error occurred',
      },
    })
  }
  app.use(errorHandler)

  return app
}
