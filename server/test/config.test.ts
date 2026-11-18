import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'

const validEnvironment = {
  MONGODB_URI: 'mongodb://user:password@localhost:27017/freshprawns?authSource=admin',
}

describe('loadConfig', () => {
  it('applies local defaults and splits configured CORS origins', () => {
    expect(loadConfig({
      ...validEnvironment,
      CORS_ORIGINS: 'http://localhost:5173,https://shop.example.test',
    })).toMatchObject({
      HOST: '127.0.0.1',
      PORT: 4000,
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      corsOrigins: ['http://localhost:5173', 'https://shop.example.test'],
    })
  })

  it('rejects missing or malformed MongoDB connection strings', () => {
    expect(() => loadConfig({})).toThrow(/MONGODB_URI/)
    expect(() => loadConfig({ MONGODB_URI: 'postgresql://localhost/shop' })).toThrow(/MONGODB_URI/)
    expect(() => loadConfig({ MONGODB_URI: 'mongodb://' })).toThrow(/MONGODB_URI/)
  })

  it('rejects unsafe CORS and invalid runtime settings', () => {
    expect(() => loadConfig({ ...validEnvironment, CORS_ORIGINS: '*' })).toThrow(/wildcard/)
    expect(() => loadConfig({ ...validEnvironment, CORS_ORIGINS: 'not-an-origin' })).toThrow(/valid origins/)
    expect(() => loadConfig({ ...validEnvironment, PORT: '70000' })).toThrow(/PORT/)
    expect(() => loadConfig({ ...validEnvironment, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/)
  })
})
