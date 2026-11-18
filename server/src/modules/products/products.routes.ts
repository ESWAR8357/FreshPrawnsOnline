import { Router } from 'express'
import { z } from 'zod'
import type { DatabaseReadiness } from '../health/health.routes.js'
import type { CatalogueRepository } from './catalogue.repository.js'

const listQuerySchema = z.object({
  size: z.enum(['Small', 'Medium', 'Large']).optional(),
  preparation: z.enum(['cleaned', 'uncleaned']).optional(),
}).strict()

const slugSchema = z.string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase product slug')

export function createProductsRouter(
  readDatabaseState: () => DatabaseReadiness,
  repository: CatalogueRepository,
): Router {
  const router = Router()
  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store')
    next()
  })

  router.get('/', async (request, response, next) => {
    const query = listQuerySchema.safeParse(request.query)
    if (!query.success) {
      response.status(400).json({
        error: {
          code: 'INVALID_QUERY',
          message: 'Product filters are invalid',
          issues: query.error.issues.map(({ path, message }) => ({ path, message })),
        },
      })
      return
    }

    if (readDatabaseState() !== 'connected') {
      response.status(503).json({
        error: { code: 'DATABASE_NOT_READY', message: 'Product catalogue is temporarily unavailable' },
      })
      return
    }

    try {
      const products = await repository.list(query.data, new Date())
      response.json({ data: products })
    } catch (error) {
      next(error)
    }
  })

  router.get('/:slug', async (request, response, next) => {
    const slug = slugSchema.safeParse(request.params.slug)
    if (!slug.success) {
      response.status(400).json({
        error: {
          code: 'INVALID_PARAMETER',
          message: 'Product slug is invalid',
          issues: slug.error.issues.map(({ path, message }) => ({ path, message })),
        },
      })
      return
    }

    if (readDatabaseState() !== 'connected') {
      response.status(503).json({
        error: { code: 'DATABASE_NOT_READY', message: 'Product catalogue is temporarily unavailable' },
      })
      return
    }

    try {
      const product = await repository.findBySlug(slug.data, new Date())
      if (!product) {
        response.status(404).json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found' } })
        return
      }
      response.json({ data: product })
    } catch (error) {
      next(error)
    }
  })

  return router
}
