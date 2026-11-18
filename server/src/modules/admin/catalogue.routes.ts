import { Router } from 'express'
import type { RequestHandler, Response } from 'express'
import { z } from 'zod'
import { HttpError } from '../../http-error.js'
import { requireAdmin } from '../users/auth.middleware.js'
import { MongoAdminCatalogueService } from './catalogue.service.js'

const slugSchema = z.string().trim().min(2).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const optionSchema = z.object({
  type: z.enum(['cleaned', 'uncleaned']),
  enabled: z.boolean(),
  feePaise: z.number().int().min(0).max(100_000),
}).strict()
const productFields = {
  slug: slugSchema,
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000),
  longDescription: z.string().trim().max(4000),
  size: z.enum(['Small', 'Medium', 'Large']),
  origin: z.string().trim().max(120),
  badge: z.string().trim().max(40),
  imageUrl: z.union([z.literal(''), z.string().url().startsWith('https://')]).nullable(),
  active: z.boolean(),
  preparationOptions: z.array(optionSchema).min(1).max(2)
    .refine((options) => new Set(options.map(({ type }) => type)).size === options.length),
}
const createSchema = z.object(productFields).strict()
const updateSchema = z.object(productFields).partial().strict().refine((body) => Object.keys(body).length > 0)
const productIdSchema = z.string().regex(/^[a-f0-9]{24}$/i)
const listSchema = z.object({
  active: z.enum(['true', 'false']).optional(),
  size: z.enum(['Small', 'Medium', 'Large']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
}).strict()
const priceSchema = z.object({
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pricePerKgPaise: z.number().int().min(1).max(1_000_000_000),
}).strict()

export type AdminProductInput = z.infer<typeof createSchema>

export interface AdminCatalogueService {
  list(filter: z.infer<typeof listSchema>): Promise<{ items: unknown[]; total: number }>
  get(productId: string): Promise<unknown>
  create(input: AdminProductInput): Promise<unknown>
  update(productId: string, input: Partial<AdminProductInput>): Promise<unknown>
  addPrice(productId: string, input: z.infer<typeof priceSchema>, actorId: string): Promise<unknown>
  listPrices(productId: string, limit: number, offset: number): Promise<{ items: unknown[]; total: number }>
}

function invalid(response: Response, error: z.ZodError) {
  response.status(400).json({
    error: {
      code: 'INVALID_REQUEST',
      message: 'Request data is invalid',
      issues: error.issues.map(({ path, message }) => ({ path, message })),
    },
  })
}

export function createAdminCatalogueRouter(
  authenticate: RequestHandler,
  service: AdminCatalogueService = new MongoAdminCatalogueService(),
): Router {
  const router = Router()
  router.use(authenticate, requireAdmin)

  router.get('/products', async (request, response, next) => {
    const query = listSchema.safeParse(request.query)
    if (!query.success) return invalid(response, query.error)
    try {
      response.json({ data: await service.list(query.data) })
    } catch (error) { next(error) }
  })

  router.get('/products/:productId', async (request, response, next) => {
    const id = productIdSchema.safeParse(request.params.productId)
    if (!id.success) return invalid(response, id.error)
    try {
      response.json({ data: await service.get(id.data) })
    } catch (error) { next(error) }
  })

  router.post('/products', async (request, response, next) => {
    const body = createSchema.safeParse(request.body)
    if (!body.success) return invalid(response, body.error)
    try {
      response.status(201).json({ data: await service.create(body.data) })
    } catch (error) { next(error) }
  })

  router.patch('/products/:productId', async (request, response, next) => {
    const id = productIdSchema.safeParse(request.params.productId)
    const body = updateSchema.safeParse(request.body)
    if (!id.success) return invalid(response, id.error)
    if (!body.success) return invalid(response, body.error)
    try {
      response.json({ data: await service.update(id.data, body.data) })
    } catch (error) { next(error) }
  })

  router.post('/products/:productId/prices', async (request, response, next) => {
    const id = productIdSchema.safeParse(request.params.productId)
    const body = priceSchema.safeParse(request.body)
    if (!id.success) return invalid(response, id.error)
    if (!body.success) return invalid(response, body.error)
    try {
      const actorId = request.authUser?.id
      if (!actorId) throw new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to continue')
      response.status(201).json({ data: await service.addPrice(id.data, body.data, actorId) })
    } catch (error) { next(error) }
  })

  router.get('/products/:productId/prices', async (request, response, next) => {
    const id = productIdSchema.safeParse(request.params.productId)
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).max(10_000).default(0),
    }).strict().safeParse(request.query)
    if (!id.success) return invalid(response, id.error)
    if (!query.success) return invalid(response, query.error)
    try {
      response.json({ data: await service.listPrices(id.data, query.data.limit, query.data.offset) })
    } catch (error) { next(error) }
  })

  return router
}
