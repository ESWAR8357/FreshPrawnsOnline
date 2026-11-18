import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'

const config = loadConfig({
  MONGODB_URI: 'mongodb://user:password@localhost:27017/freshprawns?authSource=admin',
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
})

describe('health and API foundation', () => {
  it('reports readiness when MongoDB is connected', async () => {
    const app = buildApp(config, () => 'connected')
    const response = await request(app).get('/health').set('X-Request-Id', 'health-test-1')

    expect(response.status).toBe(200)
    expect(response.headers['x-request-id']).toBe('health-test-1')
    expect(response.body).toMatchObject({
      status: 'ok',
      service: 'fresh-prawns-api',
      database: 'connected',
    })
    expect(response.body.timestamp).toEqual(expect.any(String))
    expect(JSON.stringify(response.body)).not.toContain('password')
  })

  it('reports unavailable database readiness without returning success', async () => {
    const app = buildApp(config, () => 'disconnected')
    const response = await request(app).get('/health')

    expect(response.status).toBe(503)
    expect(response.body).toMatchObject({ status: 'not_ready', database: 'disconnected' })
  })

  it('publishes the health route in the OpenAPI foundation', async () => {
    const app = buildApp(config, () => 'connected')
    const response = await request(app).get('/openapi.json')

    expect(response.status).toBe(200)
    expect(response.body.openapi).toBe('3.1.0')
    expect(response.body.paths['/health'].get.responses).toHaveProperty('503')
  })

  it('returns centralized errors and applies security headers', async () => {
    const app = buildApp(config, () => 'connected')
    const response = await request(app)
      .post('/unknown')
      .set('Content-Type', 'application/json')
      .send('{bad json')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_JSON')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
  })

  it('returns a consistent JSON 404 for unimplemented routes', async () => {
    const app = buildApp(config, () => 'connected')
    const response = await request(app).get('/api/v1/not-implemented')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('NOT_FOUND')
  })
})
