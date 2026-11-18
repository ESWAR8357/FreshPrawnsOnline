export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Fresh Prawns Online API',
    version: '1.0.0',
    description: 'Backend foundation. Business endpoints are added in later reviewed phases.',
  },
  paths: {
    '/health': {
      get: {
        summary: 'Check API and MongoDB readiness',
        responses: {
          '200': { description: 'API and MongoDB are ready' },
          '503': { description: 'MongoDB is not ready' },
        },
      },
    },
  },
} as const
