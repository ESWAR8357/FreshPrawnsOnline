import { z } from 'zod'

const configSchema = z.object({
  MONGODB_URI: z
    .string()
    .min(1)
    .refine((value) => {
      try {
        const url = new URL(value)
        return ['mongodb:', 'mongodb+srv:'].includes(url.protocol) && Boolean(url.hostname)
      } catch {
        return false
      }
    }, {
      message: 'must use mongodb:// or mongodb+srv://',
    }),
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  JWT_ACCESS_SECRET: z.string().min(32, 'must contain at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(600),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  GOOGLE_CLIENT_ID: z.string().trim().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(900000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10000).default(120),
})

export type ServerConfig = z.infer<typeof configSchema> & { corsOrigins: string[] }

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = configSchema.safeParse(env)

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ')
    throw new Error(`Invalid server configuration: ${details}`)
  }

  const corsOrigins = parsed.data.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)

  if (corsOrigins.includes('*')) {
    throw new Error('Invalid server configuration: CORS_ORIGINS must not contain a wildcard')
  }

  for (const origin of corsOrigins) {
    let url: URL
    try {
      url = new URL(origin)
    } catch {
      throw new Error('Invalid server configuration: CORS_ORIGINS must contain valid origins')
    }

    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
      throw new Error('Invalid server configuration: CORS_ORIGINS must contain valid HTTP(S) origins')
    }
  }

  return { ...parsed.data, corsOrigins }
}
