import { Router } from 'express'
import type { RequestHandler, Response } from 'express'
import { z } from 'zod'
import { HttpError } from '../../http-error.js'
import { requireAdmin } from '../users/auth.middleware.js'
import { MongoAdminStockService } from './stock.service.js'

const productIdSchema = z.string().regex(/^[a-f0-9]{24}$/i)
const adjustmentSchema = z.object({
  idempotencyKey: z.string().uuid(),
  deltaGrams: z.number().int().safe().min(-1_000_000).max(1_000_000).refine((value) => value !== 0),
  reason: z.enum(['received', 'spoilage', 'correction', 'other']),
  reference: z.string().trim().max(160).optional(),
}).strict()
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
}).strict()

export interface AdminStockService {
  list(limit: number, offset: number): Promise<{ items: unknown[]; total: number }>
  movements(productId: string, limit: number, offset: number): Promise<{ items: unknown[]; total: number }>
  adjust(productId: string, actorId: string, input: z.infer<typeof adjustmentSchema>): Promise<unknown>
}

function invalid(response: Response, error: z.ZodError) {
  response.status(400).json({
    error: { code: 'INVALID_REQUEST', message: 'Request data is invalid', issues: error.issues.map(({ path, message }) => ({ path, message })) },
  })
}

export function createAdminStockRouter(
  authenticate: RequestHandler,
  service: AdminStockService = new MongoAdminStockService(),
): Router {
  const router = Router()
  router.use(authenticate, requireAdmin)

  router.get('/', async (request, response, next) => {
    const query = querySchema.safeParse(request.query)
    if (!query.success) return invalid(response, query.error)
    try {
      response.json({ data: await service.list(query.data.limit, query.data.offset) })
    } catch (error) { next(error) }
  })

  router.get('/:productId/movements', async (request, response, next) => {
    const id = productIdSchema.safeParse(request.params.productId)
    const query = querySchema.safeParse(request.query)
    if (!id.success) return invalid(response, id.error)
    if (!query.success) return invalid(response, query.error)
    try {
      response.json({ data: await service.movements(id.data, query.data.limit, query.data.offset) })
    } catch (error) { next(error) }
  })

  router.post('/:productId/adjustments', async (request, response, next) => {
    const id = productIdSchema.safeParse(request.params.productId)
    const body = adjustmentSchema.safeParse(request.body)
    if (!id.success) return invalid(response, id.error)
    if (!body.success) return invalid(response, body.error)
    try {
      const actorId = request.authUser?.id
      if (!actorId) throw new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to continue')
      response.status(201).json({ data: await service.adjust(id.data, actorId, body.data) })
    } catch (error) { next(error) }
  })

  return router
}
