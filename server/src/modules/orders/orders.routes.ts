import { Router } from 'express'
import type { Request, RequestHandler, Response } from 'express'
import { z } from 'zod'
import { HttpError } from '../../http-error.js'
import type { CustomerOrderFilters, OrdersService } from './orders.service.js'
import { requireAdmin } from '../users/auth.middleware.js'

const createOrderSchema = z.object({
  idempotencyKey: z.string().uuid(),
  customer: z.object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().regex(/^\+?[0-9][0-9 ()-]{7,24}$/),
  }).strict(),
  address: z.object({
    line: z.string().trim().min(5).max(300),
    locality: z.string().trim().min(2).max(120),
    postalCode: z.string().trim().regex(/^[0-9]{6}$/),
  }).strict(),
  deliveryMethod: z.enum(['shop', 'third_party']),
  items: z.array(z.object({
    productSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),
    preparation: z.enum(['cleaned', 'uncleaned']),
    weightGrams: z.union([z.literal(250), z.literal(500), z.literal(1000)]),
    quantity: z.number().int().min(1).max(10),
  }).strict()).min(1).max(20),
}).strict()

const statusSchema = z.object({
  status: z.enum(['confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled']),
}).strict()

const deliveryAssignmentSchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('shop'),
    personName: z.string().trim().min(2).max(120),
    personPhone: z.string().trim().regex(/^\+?[0-9][0-9 ()-]{7,24}$/),
  }).strict(),
  z.object({
    method: z.literal('third_party'),
    serviceName: z.string().trim().min(2).max(100),
    reference: z.string().trim().max(120).optional(),
    details: z.string().trim().max(500).optional(),
  }).strict(),
])

const deliveryStatusSchema = z.object({
  status: z.enum(['assigned', 'picked_up', 'in_transit', 'exception']),
}).strict()
const orderListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/).optional(),
  status: z.enum(['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled']).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
}).strict().superRefine((query, context) => {
  if (query.from && query.to && new Date(query.from).getTime() >= new Date(query.to).getTime()) {
    context.addIssue({ code: 'custom', path: ['from'], message: 'from must be earlier than to' })
  }
})

const orderIdSchema = z.string().regex(/^[a-f0-9]{24}$/i)

function invalidRequest(response: Response, issues: z.ZodIssue[]) {
  response.status(400).json({
    error: {
      code: 'INVALID_REQUEST',
      message: 'Request data is invalid',
      issues: issues.map(({ path, message }) => ({ path, message })),
    },
  })
}

function adminActor(request: Request) {
  const user = request.authUser
  if (!user || user.role !== 'admin') {
    throw new HttpError(403, 'ADMIN_ACCESS_REQUIRED', 'Administrator access is required')
  }
  return { id: user.id, role: 'admin' as const }
}

export function createOrdersRouter(service: OrdersService, authenticate: RequestHandler): Router {
  const router = Router()
  router.use(authenticate)
  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store')
    next()
  })

  router.post('/', async (request, response, next) => {
    const parsed = createOrderSchema.safeParse(request.body)
    if (!parsed.success) {
      invalidRequest(response, parsed.error.issues)
      return
    }
    if (!request.authUser || request.authUser.role !== 'customer') {
      response.status(403).json({ error: { code: 'CUSTOMER_ACCOUNT_REQUIRED', message: 'A customer account is required to place an order' } })
      return
    }
    try {
      const order = await service.create(request.authUser.id, parsed.data)
      response.status(201).json({ data: order })
    } catch (error) {
      next(error)
    }
  })

  router.get('/', async (request, response, next) => {
    const parsedQuery = orderListSchema.safeParse(request.query)
    if (!parsedQuery.success) {
      invalidRequest(response, parsedQuery.error.issues)
      return
    }
    if (!request.authUser) {
      next(new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to continue'))
      return
    }
    try {
      const orders = request.authUser.role === 'admin'
        ? await service.listForAdmin()
        : await service.listForCustomer(request.authUser.id, {
            limit: parsedQuery.data.limit,
            ...(parsedQuery.data.cursor ? { cursor: parsedQuery.data.cursor } : {}),
            ...(parsedQuery.data.status ? { status: parsedQuery.data.status } : {}),
            ...(parsedQuery.data.from ? { from: new Date(parsedQuery.data.from) } : {}),
            ...(parsedQuery.data.to ? { to: new Date(parsedQuery.data.to) } : {}),
          } satisfies CustomerOrderFilters)
      if (Array.isArray(orders)) {
        response.json({ data: orders })
      } else {
        response.json({ data: orders.items, pagination: { nextCursor: orders.nextCursor } })
      }
    } catch (error) {
      next(error)
    }
  })

  router.get('/:id', async (request, response, next) => {
    const id = orderIdSchema.safeParse(request.params.id)
    if (!id.success) {
      invalidRequest(response, id.error.issues)
      return
    }
    try {
      const user = request.authUser
      if (!user) throw new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to continue')
      const order = await service.getById(id.data, user.id, user.role === 'admin')
      response.json({ data: order })
    } catch (error) {
      next(error)
    }
  })

  router.get('/:id/events', async (request, response, next) => {
    const id = orderIdSchema.safeParse(request.params.id)
    if (!id.success) {
      invalidRequest(response, id.error.issues)
      return
    }
    try {
      const user = request.authUser
      if (!user) throw new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to continue')
      const events = await service.listEvents(id.data, user.id, user.role === 'admin')
      response.json({ data: events })
    } catch (error) {
      next(error)
    }
  })

  router.patch('/:id/status', requireAdmin, async (request, response, next) => {
    const id = orderIdSchema.safeParse(request.params.id)
    const body = statusSchema.safeParse(request.body)
    if (!id.success || !body.success) {
      invalidRequest(response, !id.success ? id.error.issues : body.success ? [] : body.error.issues)
      return
    }
    try {
      const order = await service.updateStatus(id.data, body.data.status, adminActor(request))
      response.json({ data: order })
    } catch (error) {
      next(error)
    }
  })

  router.patch('/:id/delivery', requireAdmin, async (request, response, next) => {
    const id = orderIdSchema.safeParse(request.params.id)
    const body = deliveryAssignmentSchema.safeParse(request.body)
    if (!id.success || !body.success) {
      invalidRequest(response, !id.success ? id.error.issues : body.success ? [] : body.error.issues)
      return
    }
    try {
      const order = await service.assignDelivery(id.data, body.data, adminActor(request))
      response.json({ data: order })
    } catch (error) {
      next(error)
    }
  })

  router.patch('/:id/delivery/status', requireAdmin, async (request, response, next) => {
    const id = orderIdSchema.safeParse(request.params.id)
    const body = deliveryStatusSchema.safeParse(request.body)
    if (!id.success || !body.success) {
      invalidRequest(response, !id.success ? id.error.issues : body.success ? [] : body.error.issues)
      return
    }
    try {
      const order = await service.updateDeliveryStatus(id.data, body.data.status, adminActor(request))
      response.json({ data: order })
    } catch (error) {
      next(error)
    }
  })

  return router
}
