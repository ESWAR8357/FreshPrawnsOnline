import { Router } from 'express'

export type DatabaseReadiness = 'connected' | 'disconnected' | 'connecting' | 'disconnecting'

export function createHealthRouter(readDatabaseState: () => DatabaseReadiness): Router {
  const router = Router()

  router.get('/', (_request, response) => {
    const database = readDatabaseState()
    const ready = database === 'connected'
    response.status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'not_ready',
      service: 'fresh-prawns-api',
      database,
      timestamp: new Date().toISOString(),
    })
  })

  return router
}
