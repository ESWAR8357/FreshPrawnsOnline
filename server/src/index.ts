import { createServer } from 'node:http'
import pino from 'pino'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { connectDatabase, disconnectDatabase } from './database.js'
import { MongoOrdersService } from './modules/orders/orders.service.js'

const config = loadConfig()
const logger = pino({
  level: config.LOG_LEVEL,
  redact: ['MONGODB_URI'],
})

try {
  await connectDatabase(config.MONGODB_URI)
} catch (error) {
  logger.error({ errorName: error instanceof Error ? error.name : 'UnknownError' }, 'MongoDB connection failed; API startup aborted')
  process.exit(1)
}

const ordersService = new MongoOrdersService()
try {
  await ordersService.recoverIncompleteOperations()
} catch (error) {
  logger.error({ errorName: error instanceof Error ? error.name : 'UnknownError' }, 'Incomplete order stock operations could not be recovered; API startup aborted')
  await disconnectDatabase()
  process.exit(1)
}

const app = buildApp(config, undefined, undefined, { orders: ordersService })
const server = createServer(app)

server.listen(config.PORT, config.HOST, () => {
  logger.info({ host: config.HOST, port: config.PORT }, 'API listening')
})

const shutdown = () => {
  logger.info('API shutdown requested')
  server.close(() => {
    void disconnectDatabase().finally(() => process.exit(0))
  })
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
