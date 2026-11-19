import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'

const config = loadConfig({
  MONGODB_URI: 'mongodb://user:password@localhost:27017/freshprawns?authSource=admin',
  NODE_ENV: 'test',
  JWT_ACCESS_SECRET: 'test-only-replace-with-random-secret-material',
  LOG_LEVEL: 'silent',
})

// ---------------------------------------------------------------------------
// Minimal dist/ tree: index.html at root + one static asset
// ---------------------------------------------------------------------------
let distDir: string

beforeAll(() => {
  distDir = mkdtempSync(join(tmpdir(), 'fresh-prawns-test-dist-'))
  writeFileSync(join(distDir, 'index.html'), '<!doctype html><html><body>SPA</body></html>')
  mkdirSync(join(distDir, 'assets'))
  writeFileSync(join(distDir, 'assets', 'main.js'), '// bundled js')
})

afterAll(() => {
  rmSync(distDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Static serving active (dist/ exists)
// ---------------------------------------------------------------------------
describe('static serving and SPA fallback when dist/ is present', () => {
  it('serves index.html for the root path', async () => {
    const app = buildApp(config, () => 'connected', undefined, {}, distDir)
    const response = await request(app).get('/')
    expect(response.status).toBe(200)
    expect(response.text).toContain('SPA')
    expect(response.headers['content-type']).toMatch(/html/)
  })

  it('serves index.html for React Router paths that have no matching file', async () => {
    const app = buildApp(config, () => 'connected', undefined, {}, distDir)
    const paths = ['/shop', '/cart', '/account', '/checkout', '/track', '/admin', '/admin/orders']
    for (const path of paths) {
      const response = await request(app).get(path)
      expect(response.status).toBe(200)
      expect(response.text).toContain('SPA')
    }
  })

  it('serves a static asset directly without going through the SPA fallback', async () => {
    const app = buildApp(config, () => 'connected', undefined, {}, distDir)
    const response = await request(app).get('/assets/main.js')
    expect(response.status).toBe(200)
    expect(response.text).toContain('bundled js')
    expect(response.headers['content-type']).toMatch(/javascript/)
  })

  it('returns JSON 404 for unknown /api routes even when dist/ is present', async () => {
    const app = buildApp(config, () => 'connected', undefined, {}, distDir)
    const paths = ['/api/unknown', '/api/v1/does-not-exist']
    for (const path of paths) {
      const response = await request(app).get(path)
      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('NOT_FOUND')
      expect(response.headers['content-type']).toMatch(/json/)
    }
  })

  it('real API responses are unaffected by static serving', async () => {
    const app = buildApp(config, () => 'connected', undefined, {}, distDir)
    const response = await request(app).get('/health')
    expect(response.status).toBe(200)
    expect(response.body.status).toBe('ok')
  })
})

// ---------------------------------------------------------------------------
// Static serving skipped (dist/ absent — local API-only dev workflow)
// ---------------------------------------------------------------------------
describe('static serving skipped when dist/ is absent', () => {
  let absentDist: string

  beforeAll(() => {
    absentDist = resolve(tmpdir(), `fresh-prawns-absent-dist-${Date.now()}`)
  })

  it('API routes work normally when dist/ does not exist', async () => {
    const app = buildApp(config, () => 'connected', undefined, {}, absentDist)
    const response = await request(app).get('/health')
    expect(response.status).toBe(200)
    expect(response.body.status).toBe('ok')
  })

  it('returns JSON 404 for unknown /api routes when dist/ does not exist', async () => {
    const app = buildApp(config, () => 'connected', undefined, {}, absentDist)
    const response = await request(app).get('/api/v1/does-not-exist')
    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('NOT_FOUND')
  })
})
