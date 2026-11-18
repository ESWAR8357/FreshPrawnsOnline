export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Fresh Prawns Online API',
    version: '1.0.0',
    description: 'Public product catalogue, current daily prices, and available stock. Admin mutations require authentication and are not yet implemented.',
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
    '/api/v1/products': {
      get: {
        summary: 'List active products with current prices and available stock',
        parameters: [
          {
            name: 'size',
            in: 'query',
            schema: { type: 'string', enum: ['Small', 'Medium', 'Large'] },
          },
          {
            name: 'preparation',
            in: 'query',
            schema: { type: 'string', enum: ['cleaned', 'uncleaned'] },
          },
        ],
        responses: {
          '200': {
            description: 'Active product catalogue',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data'],
                  properties: {
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/PublicProduct' },
                    },
                  },
                },
              },
            },
          },
          '400': { description: 'Invalid catalogue filter' },
          '503': { description: 'MongoDB is not ready' },
        },
      },
    },
    '/api/v1/products/{slug}': {
      get: {
        summary: 'Get an active product with its current price and stock',
        parameters: [
          {
            name: 'slug',
            in: 'path',
            required: true,
            schema: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
          },
        ],
        responses: {
          '200': {
            description: 'Product details',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data'],
                  properties: {
                    data: { $ref: '#/components/schemas/PublicProduct' },
                  },
                },
              },
            },
          },
          '400': { description: 'Invalid product slug' },
          '404': { description: 'Product not found' },
          '503': { description: 'MongoDB is not ready' },
        },
      },
    },
  },
  components: {
    schemas: {
      PublicProduct: {
        type: 'object',
        required: [
          'id',
          'slug',
          'name',
          'size',
          'active',
          'sampleData',
          'preparationOptions',
          'pricePerKgPaise',
          'priceEffectiveFrom',
          'stock',
        ],
        properties: {
          id: { type: 'string', description: 'Stable product slug used by storefront routes' },
          slug: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          longDescription: { type: 'string' },
          size: { type: 'string', enum: ['Small', 'Medium', 'Large'] },
          origin: { type: 'string' },
          badge: { type: 'string' },
          imageUrl: { type: ['string', 'null'], format: 'uri' },
          active: { type: 'boolean' },
          sampleData: { type: 'boolean', description: 'True for local/demo seed records' },
          preparationOptions: {
            type: 'array',
            items: {
              type: 'object',
              required: ['type', 'enabled', 'feePaise'],
              properties: {
                type: { type: 'string', enum: ['cleaned', 'uncleaned'] },
                enabled: { type: 'boolean' },
                feePaise: { type: 'integer', minimum: 0 },
              },
            },
          },
          pricePerKgPaise: { type: ['integer', 'null'], minimum: 1 },
          priceEffectiveFrom: { type: ['string', 'null'], format: 'date-time' },
          stock: {
            type: 'object',
            required: ['onHandGrams', 'availableGrams'],
            properties: {
              onHandGrams: { type: 'integer', minimum: 0 },
              availableGrams: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
    },
  },
} as const
