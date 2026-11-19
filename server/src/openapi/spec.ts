export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Fresh Prawns Online API',
    version: '1.0.0',
    description: 'Customer accounts, order management, manual delivery assignment, admin catalogue/pricing/stock management, and order history.',
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
    '/api/v1/admin/products': {
      get: {
        summary: 'List products including inactive products (admin only)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'active', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
          { name: 'size', in: 'query', schema: { type: 'string', enum: ['Small', 'Medium', 'Large'] } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 } },
        ],
        responses: { '200': { description: 'Products and total count' }, '401': { description: 'Authentication required' }, '403': { description: 'Administrator access required' } },
      },
      post: {
        summary: 'Create a product (admin only)',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/AdminProductInput' } } } },
        responses: { '201': { description: 'Product created' }, '400': { description: 'Invalid product data' }, '409': { description: 'Product slug already exists' } },
      },
    },
    '/api/v1/admin/products/{productId}': {
      get: {
        summary: 'Get a product including inactive products (admin only)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'productId', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{24}$' } }],
        responses: { '200': { description: 'Product details' }, '404': { description: 'Product not found' } },
      },
      patch: {
        summary: 'Update or deactivate a product (admin only)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'productId', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{24}$' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/AdminProductPatch' } } } },
        responses: { '200': { description: 'Product updated' }, '400': { description: 'Invalid product patch' }, '404': { description: 'Product not found' }, '409': { description: 'Product slug already exists' } },
      },
    },
    '/api/v1/admin/products/{productId}/prices': {
      get: {
        summary: 'List price history for a product (admin only)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'productId', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{24}$' } }],
        responses: { '200': { description: 'Price history and total count' }, '404': { description: 'Product not found' } },
      },
      post: {
        summary: 'Append a daily price at Hyderabad local midnight (admin only)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'productId', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{24}$' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/DailyPriceInput' } } } },
        responses: { '201': { description: 'Daily price appended' }, '400': { description: 'Invalid price or date' }, '409': { description: 'Price date is not later than the existing history' } },
      },
    },
    '/api/v1/admin/stock': {
      get: {
        summary: 'List stock balances and availability (admin only)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 } },
        ],
        responses: { '200': { description: 'Stock balances and total count' } },
      },
    },
    '/api/v1/admin/stock/{productId}/adjustments': {
      post: {
        summary: 'Apply an idempotent on-hand stock adjustment (admin only)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'productId', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{24}$' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/StockAdjustmentInput' } } } },
        responses: { '201': { description: 'Stock adjusted and movement recorded' }, '400': { description: 'Invalid adjustment' }, '409': { description: 'Stock/reservation bounds would be violated' } },
      },
    },
    '/api/v1/admin/stock/{productId}/movements': {
      get: {
        summary: 'List append-only stock movements (admin only)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'productId', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{24}$' } }],
        responses: { '200': { description: 'Stock movements and total count' }, '404': { description: 'Product not found' } },
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
                    parameters: [
                      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50 } },
                      { name: 'cursor', in: 'query', schema: { type: 'string', maxLength: 256 } },
                      { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'] } },
                      { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
                      { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
                    ],
                    responses: { '200': { description: 'Orders visible to the authenticated user' } },
                  },
                  post: {
                    summary: 'Create an order using current server prices and stock',
                    description: 'Accepts selections only; prices, fees, stock reservations, totals, and initial pay-on-delivery status are set by the server. New orders start as pending_collection and are never marked collected at placement.',
                    security: [{ bearerAuth: [] }],
                    requestBody: {
                      required: true,
                      content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateOrder' } } },
                    },
                    responses: {
                      '201': {
                        description: 'Order created with server-calculated totals and pending pay-on-delivery collection status',
                        content: { 'application/json': { schema: {
                          type: 'object',
                          required: ['data'],
                          properties: { data: { $ref: '#/components/schemas/OrderPayment' } },
                        } } },
                      },
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
                      '200': {
                        description: 'Order details, including server-owned payment method and collection status',
                        content: { 'application/json': { schema: {
                          type: 'object',
                          required: ['data'],
                          properties: { data: { $ref: '#/components/schemas/OrderPayment' } },
                        } } },
                      },
                      '404': { description: 'Order not found or not visible to this account' },
                    },
                  },
    },
    '/api/v1/orders/{id}/events': {
      get: {
        summary: 'List order status and delivery events visible to the owner or an admin',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{24}$' } }],
        responses: {
          '200': { description: 'Append-only order event history' },
          '401': { description: 'Authentication required' },
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
    '/api/v1/orders/{id}/payment/collection': {
      patch: {
        summary: 'Record pay-on-delivery collection (admin only)',
        description: 'Allowed only after order delivery. This performs the one-way pending_collection to collected transition and appends an order audit event. Repeated requests are idempotent. Customers cannot change payment records.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{24}$' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', additionalProperties: false, properties: {} } } },
        },
        responses: {
          '200': {
            description: 'Order with paymentStatus collected and collection audit event',
            content: { 'application/json': { schema: {
              type: 'object',
              required: ['data'],
              properties: { data: { $ref: '#/components/schemas/OrderPayment' } },
            } } },
          },
          '400': { description: 'Invalid request body' },
          '401': { description: 'Authentication required' },
          '403': { description: 'Administrator access required' },
          '404': { description: 'Order not found' },
          '409': { description: 'Order is not delivered or payment is not collectible' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      AdminProductInput: {
        type: 'object',
        additionalProperties: false,
        required: ['slug', 'name', 'description', 'longDescription', 'size', 'origin', 'badge', 'imageUrl', 'active', 'preparationOptions'],
        properties: {
          slug: { type: 'string', minLength: 2, maxLength: 120, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
          name: { type: 'string', minLength: 2, maxLength: 120 },
          description: { type: 'string', maxLength: 2000 },
          longDescription: { type: 'string', maxLength: 4000 },
          size: { type: 'string', enum: ['Small', 'Medium', 'Large'] },
          origin: { type: 'string', maxLength: 120 },
          badge: { type: 'string', maxLength: 40 },
          imageUrl: { type: ['string', 'null'], format: 'uri' },
          active: { type: 'boolean' },
          preparationOptions: { type: 'array', minItems: 1, maxItems: 2 },
        },
      },
      AdminProductPatch: {
        type: 'object',
        minProperties: 1,
        additionalProperties: false,
        description: 'A non-empty subset of AdminProductInput fields.',
        properties: {
          slug: { type: 'string', minLength: 2, maxLength: 120, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
          name: { type: 'string', minLength: 2, maxLength: 120 },
          description: { type: 'string', maxLength: 2000 },
          longDescription: { type: 'string', maxLength: 4000 },
          size: { type: 'string', enum: ['Small', 'Medium', 'Large'] },
          origin: { type: 'string', maxLength: 120 },
          badge: { type: 'string', maxLength: 40 },
          imageUrl: { type: ['string', 'null'], format: 'uri' },
          active: { type: 'boolean' },
          preparationOptions: { type: 'array', minItems: 1, maxItems: 2 },
        },
      },
      DailyPriceInput: {
        type: 'object',
        additionalProperties: false,
        required: ['effectiveDate', 'pricePerKgPaise'],
        properties: {
          effectiveDate: { type: 'string', format: 'date', description: 'Hyderabad calendar date; effective at 00:00 Asia/Kolkata.' },
          pricePerKgPaise: { type: 'integer', minimum: 1, maximum: 1000000000 },
        },
      },
      StockAdjustmentInput: {
        type: 'object',
        additionalProperties: false,
        required: ['idempotencyKey', 'deltaGrams', 'reason'],
        properties: {
          idempotencyKey: { type: 'string', format: 'uuid' },
          deltaGrams: { type: 'integer', minimum: -1000000, maximum: 1000000, description: 'Signed on-hand delta; cannot reduce below reserved grams.' },
          reason: { type: 'string', enum: ['received', 'spoilage', 'correction', 'other'] },
          reference: { type: 'string', maxLength: 160 },
        },
      },
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
      OrderPayment: {
        type: 'object',
        required: ['paymentMethod', 'paymentStatus', 'paymentCollectedAt'],
        properties: {
          paymentMethod: { type: 'string', const: 'pay_on_delivery' },
          paymentStatus: { type: 'string', enum: ['pending_collection', 'collected', 'not_collectible'] },
          paymentCollectedAt: { type: ['string', 'null'], format: 'date-time' },
        },
        description: 'Order data includes these server-owned payment fields; create-order requests must not include them.',
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
