export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Fresh Prawns Online API',
    version: '1.0.0',
    description: 'Customer accounts, order management, manual delivery assignment, and the public product catalogue.',
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
    '/api/v1/auth/register': {
                  post: {
                    summary: 'Register a customer account',
                    description: 'Public registration always assigns the customer role. Administrative accounts are provisioned out of band.',
                    requestBody: {
                      required: true,
                      content: { 'application/json': { schema: { $ref: '#/components/schemas/Credentials' } } },
                    },
                    responses: {
                      '201': { description: 'Customer account created; refresh token is set in an HttpOnly cookie' },
                      '400': { description: 'Invalid credentials input' },
                      '409': { description: 'Email is already registered' },
                    },
                  },
    },
    '/api/v1/auth/login': {
                  post: {
                    summary: 'Sign in',
                    requestBody: {
                      required: true,
                      content: { 'application/json': { schema: { $ref: '#/components/schemas/Credentials' } } },
                    },
                    responses: {
                      '200': { description: 'Access token returned; rotating refresh token set in an HttpOnly cookie' },
                      '401': { description: 'Invalid credentials' },
                    },
                  },
    },
    '/api/v1/auth/refresh': {
                  post: {
                    summary: 'Rotate the refresh token and issue a new access token',
                    responses: {
                      '200': { description: 'Tokens rotated' },
                      '401': { description: 'Refresh session invalid or expired' },
                    },
                  },
    },
    '/api/v1/auth/logout': {
                  post: {
                    summary: 'Revoke the current refresh session',
                    responses: { '204': { description: 'Refresh session revoked' } },
                  },
    },
    '/api/v1/auth/me': {
                  get: {
                    summary: 'Get the authenticated account',
                    security: [{ bearerAuth: [] }],
                    responses: { '200': { description: 'Authenticated account' }, '401': { description: 'Authentication required' } },
                  },
    },
    '/api/v1/orders': {
                  get: {
                    summary: 'List the authenticated customer’s orders or recent admin orders',
                    security: [{ bearerAuth: [] }],
                    responses: { '200': { description: 'Orders visible to the authenticated user' } },
                  },
                  post: {
                    summary: 'Create an order using current server prices and stock',
                    description: 'Accepts selections only; prices, fees, stock reservations, and totals are calculated by the server.',
                    security: [{ bearerAuth: [] }],
                    requestBody: {
                      required: true,
                      content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateOrder' } } },
                    },
                    responses: {
                      '201': { description: 'Order created with server-calculated totals' },
                      '400': { description: 'Invalid order input' },
                      '409': { description: 'Price, preparation option, or stock is unavailable' },
                    },
                  },
    },
    '/api/v1/orders/{id}': {
                  get: {
                    summary: 'Get an order visible to the authenticated customer or admin',
                    security: [{ bearerAuth: [] }],
                    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{24}$' } }],
                    responses: {
                      '200': { description: 'Order details' },
                      '404': { description: 'Order not found or not visible to this account' },
                    },
                  },
    },
    '/api/v1/orders/{id}/status': {
                  patch: {
                    summary: 'Change an order status (admin only)',
                    security: [{ bearerAuth: [] }],
                    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{24}$' } }],
                    requestBody: {
                      required: true,
                      content: { 'application/json': { schema: {
                        type: 'object',
                        required: ['status'],
                        properties: { status: { type: 'string', enum: ['confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'] } },
                      } } },
                    },
                    responses: {
                      '200': { description: 'Order status updated' },
                      '401': { description: 'Authentication required' },
                      '403': { description: 'Administrator access required' },
                      '409': { description: 'Invalid status transition or stock reconciliation required' },
                    },
                  },
    },
    '/api/v1/orders/{id}/delivery': {
                  patch: {
                    summary: 'Assign or update manual delivery details (admin only)',
                    description: 'Records shop-person contact information or manually entered third-party details. It does not contact a delivery provider.',
                    security: [{ bearerAuth: [] }],
                    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{24}$' } }],
                    requestBody: {
                      required: true,
                      content: { 'application/json': { schema: { $ref: '#/components/schemas/DeliveryAssignment' } } },
                    },
                    responses: {
                      '200': { description: 'Delivery assignment saved' },
                      '400': { description: 'Invalid delivery assignment' },
                      '401': { description: 'Authentication required' },
                      '403': { description: 'Administrator access required' },
                      '409': { description: 'Order is no longer assignable' },
                    },
                  },
    },
    '/api/v1/orders/{id}/delivery/status': {
                  patch: {
                    summary: 'Update manual delivery progress (admin only)',
                    security: [{ bearerAuth: [] }],
                    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{24}$' } }],
                    requestBody: {
                      required: true,
                      content: { 'application/json': { schema: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['status'],
                        properties: { status: { type: 'string', enum: ['assigned', 'picked_up', 'in_transit', 'exception'] } },
                      } } },
                    },
                    responses: {
                      '200': { description: 'Delivery status updated' },
                      '401': { description: 'Authentication required' },
                      '403': { description: 'Administrator access required' },
                      '409': { description: 'Invalid delivery status transition' },
                    },
                  },
                },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Credentials: {
        type: 'object',
        additionalProperties: false,
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email', maxLength: 254 },
          password: { type: 'string', minLength: 12, maxLength: 128 },
        },
      },
      CreateOrder: {
        type: 'object',
        additionalProperties: false,
        required: ['idempotencyKey', 'customer', 'address', 'deliveryMethod', 'items'],
        properties: {
          idempotencyKey: { type: 'string', format: 'uuid' },
          customer: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'phone'],
            properties: { name: { type: 'string', minLength: 2, maxLength: 120 }, phone: { type: 'string' } },
          },
          address: {
            type: 'object',
            additionalProperties: false,
            required: ['line', 'locality', 'postalCode'],
            properties: {
              line: { type: 'string', minLength: 5, maxLength: 300 },
              locality: { type: 'string', minLength: 2, maxLength: 120 },
              postalCode: { type: 'string', pattern: '^[0-9]{6}$' },
            },
          },
          deliveryMethod: { type: 'string', enum: ['shop', 'third_party'] },
          items: {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['productSlug', 'preparation', 'weightGrams', 'quantity'],
              properties: {
                productSlug: { type: 'string' },
                preparation: { type: 'string', enum: ['cleaned', 'uncleaned'] },
                weightGrams: { type: 'integer', enum: [250, 500, 1000] },
                quantity: { type: 'integer', minimum: 1, maximum: 10 },
              },
            },
          },
        },
      },
      DeliveryAssignment: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['method', 'personName', 'personPhone'],
            properties: {
              method: { const: 'shop' },
              personName: { type: 'string', minLength: 2, maxLength: 120 },
              personPhone: { type: 'string', pattern: '^\\+?[0-9][0-9 ()-]{7,24}$' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['method', 'serviceName'],
            properties: {
              method: { const: 'third_party' },
              serviceName: { type: 'string', minLength: 2, maxLength: 100 },
              reference: { type: 'string', maxLength: 120 },
              details: { type: 'string', maxLength: 500, description: 'Admin-only manual notes; never included in customer responses.' },
            },
          },
        ],
      },
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
