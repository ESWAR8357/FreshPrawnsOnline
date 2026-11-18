import { SignJWT } from 'jose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import type { AuthService, AuthTokens, AuthUser } from '../src/modules/users/auth.service.js'
import type { OrdersService } from '../src/modules/orders/orders.service.js'

const config = loadConfig({
  MONGODB_URI: 'mongodb://localhost:27017/freshprawns?authSource=admin',
  JWT_ACCESS_SECRET: 'test-only-replace-with-random-secret-material',
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
})

const customer: AuthUser = { id: '507f1f77bcf86cd799439011', email: 'customer@example.test', role: 'customer' }
const admin: AuthUser = { id: '507f1f77bcf86cd799439012', email: 'admin@example.test', role: 'admin' }
const createdOrder = {
  id: '507f1f77bcf86cd799439099',
  customerName: 'Ananya Rao',
  customerPhone: '+919876543210',
  address: { line: '12 Lake View Road', locality: 'Banjara Hills', city: 'Hyderabad', postalCode: '500034' },
  status: 'pending',
  deliveryMethod: 'shop' as const,
  deliveryAssignment: {
    method: 'shop' as const,
    status: 'not_assigned',
    details: 'Admin-only delivery details',
  },
  items: [{
    productName: 'White Prawns',
    preparation: 'cleaned' as const,
    weightGrams: 500,
    quantity: 1,
    pricePerKgPaise: 68000,
    preparationFeePaise: 4000,
    lineTotalPaise: 38000,
  }],
  subtotalPaise: 38000,
  deliveryFeePaise: 4000,
  totalPaise: 42000,
  createdAt: new Date('2026-03-20T10:00:00.000Z'),
}

describe('account and order authorization APIs', () => {
  const auth: AuthService = {
    register: vi.fn(async () => ({
      user: customer,
      accessToken: 'issued-access-token',
      refreshToken: 'opaque-refresh-token',
    })),
    login: vi.fn(async () => ({
      user: customer,
      accessToken: 'issued-access-token',
      refreshToken: 'opaque-refresh-token',
    })),
    refresh: vi.fn(async (): Promise<AuthTokens> => ({
      user: customer,
      accessToken: 'rotated-access-token',
      refreshToken: 'rotated-refresh-token',
    })),
    logout: vi.fn(async () => {}),
    getActiveUser: vi.fn(async (id) => id === admin.id ? admin : id === customer.id ? customer : null),
  }
  const orders: OrdersService = {
    create: vi.fn(async () => createdOrder),
    listForCustomer: vi.fn(async () => ({ items: [createdOrder], nextCursor: null })),
    listForAdmin: vi.fn(async () => [createdOrder]),
    getById: vi.fn(async () => createdOrder),
    listEvents: vi.fn(async () => [{
      id: '507f1f77bcf86cd799439088',
      type: 'order_status_changed',
      actorRole: 'admin',
      from: 'pending',
      to: 'confirmed',
      createdAt: new Date('2026-03-20T10:01:00.000Z'),
    }]),
    updateStatus: vi.fn(async () => ({ ...createdOrder, status: 'confirmed' })),
    assignDelivery: vi.fn(async (_id, assignment) => ({
      ...createdOrder,
      deliveryMethod: assignment.method,
      deliveryAssignment: { ...assignment, status: 'assigned' },
    })),
    updateDeliveryStatus: vi.fn(async (_id, status) => ({
      ...createdOrder,
      deliveryAssignment: { ...createdOrder.deliveryAssignment, status },
    })),
    recoverIncompleteOperations: vi.fn(async () => {}),
  }
  const app = buildApp(config, () => 'connected', undefined, { auth, orders })

  beforeEach(() => vi.clearAllMocks())

  async function bearer(user: AuthUser): Promise<string> {
    return new SignJWT({ role: user.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer('fresh-prawns-api')
      .setAudience('fresh-prawns-web')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(config.JWT_ACCESS_SECRET))
  }

  const validOrder = {
    idempotencyKey: 'cbd0edc0-536d-4c30-9b30-8f248822b128',
    customer: { name: 'Ananya Rao', phone: '+91 98765 43210' },
    address: { line: '12 Lake View Road', locality: 'Banjara Hills', postalCode: '500034' },
    deliveryMethod: 'shop',
    items: [{ productSlug: 'white-prawns', preparation: 'cleaned', weightGrams: 500, quantity: 1 }],
  }

  it('creates customer-only accounts and refuses client-selected roles', async () => {
    const invalid = await request(app).post('/api/v1/auth/register').send({
      email: 'owner@example.test',
      password: 'a-long-enough-test-password',
      role: 'admin',
    })
    expect(invalid.status).toBe(400)
    expect(auth.register).not.toHaveBeenCalled()

    const response = await request(app).post('/api/v1/auth/register').send({
      email: 'Customer@Example.Test',
      password: 'a-long-enough-test-password',
    })
    expect(response.status).toBe(201)
    expect(auth.register).toHaveBeenCalledWith('customer@example.test', 'a-long-enough-test-password')
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly')
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Strict')
    expect(response.body.data.user.role).toBe('customer')
  })

  it('requires authentication and scopes customer order history to the signed-in customer', async () => {
    const unauthorized = await request(app).get('/api/v1/orders')
    expect(unauthorized.status).toBe(401)

    const token = await bearer(customer)
    const response = await request(app).get('/api/v1/orders').set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(200)
    expect(orders.listForCustomer).toHaveBeenCalledWith(customer.id, { limit: 20 })
    expect(orders.listForAdmin).not.toHaveBeenCalled()
  })

  it('validates customer order history filters before querying the service', async () => {
    const token = await bearer(customer)
    const response = await request(app)
      .get('/api/v1/orders')
      .query({ status: 'unknown', limit: '1000' })
      .set('Authorization', `Bearer ${token}`)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_REQUEST')
    expect(orders.listForCustomer).not.toHaveBeenCalled()
  })

  it('only reads an order through the authenticated owner scope', async () => {
    const token = await bearer(customer)
    const response = await request(app)
      .get(`/api/v1/orders/${createdOrder.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(response.status).toBe(200)
    expect(orders.getById).toHaveBeenCalledWith(createdOrder.id, customer.id, false)
  })

  it('returns order event history only through the authenticated owner scope', async () => {
    const token = await bearer(customer)
    const response = await request(app)
      .get(`/api/v1/orders/${createdOrder.id}/events`)
      .set('Authorization', `Bearer ${token}`)

    expect(response.status).toBe(200)
    expect(response.body.data[0]).toMatchObject({
      type: 'order_status_changed',
      actorRole: 'admin',
      from: 'pending',
      to: 'confirmed',
    })
    expect(orders.listEvents).toHaveBeenCalledWith(createdOrder.id, customer.id, false)
  })

  it('rejects access tokens with the wrong issuer or audience', async () => {
    const token = await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(admin.id)
      .setIssuer('unexpected-issuer')
      .setAudience('unexpected-client')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(config.JWT_ACCESS_SECRET))
    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)

    expect(response.status).toBe(401)
    expect(auth.getActiveUser).not.toHaveBeenCalled()
  })

  it('rotates refresh cookies and revokes them on logout', async () => {
    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', 'freshprawns_refresh=opaque-refresh-token')
    expect(refreshed.status).toBe(200)
    expect(auth.refresh).toHaveBeenCalledWith('opaque-refresh-token')
    expect(refreshed.headers['set-cookie'][0]).toContain('rotated-refresh-token')

    const loggedOut = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', 'freshprawns_refresh=rotated-refresh-token')
    expect(loggedOut.status).toBe(204)
    expect(auth.logout).toHaveBeenCalledWith('rotated-refresh-token')
  })

  it('rejects refresh-cookie actions from untrusted browser origins', async () => {
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', 'https://attacker.example')
      .set('Cookie', 'freshprawns_refresh=opaque-refresh-token')

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('ORIGIN_NOT_ALLOWED')
    expect(auth.refresh).not.toHaveBeenCalled()
  })

  it('rejects browser-supplied prices and totals before order creation', async () => {
    const token = await bearer(customer)
    const response = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validOrder, totalPaise: 1, items: [{ ...validOrder.items[0], pricePerKgPaise: 1 }] })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_REQUEST')
    expect(orders.create).not.toHaveBeenCalled()
  })

  it('creates an order using only the validated customer selections and returns server totals', async () => {
    const token = await bearer(customer)
    const response = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send(validOrder)

    expect(response.status).toBe(201)
    expect(orders.create).toHaveBeenCalledWith(customer.id, validOrder)
    expect(response.body.data.totalPaise).toBe(42000)
  })

  it('denies customer order-status changes and allows an authenticated admin', async () => {
    const customerToken = await bearer(customer)
    const denied = await request(app)
      .patch(`/api/v1/orders/${createdOrder.id}/status`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ status: 'confirmed' })
    expect(denied.status).toBe(403)
    expect(orders.updateStatus).not.toHaveBeenCalled()

    const adminToken = await bearer(admin)
    const allowed = await request(app)
      .patch(`/api/v1/orders/${createdOrder.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'confirmed' })
    expect(allowed.status).toBe(200)
    expect(orders.updateStatus).toHaveBeenCalledWith(createdOrder.id, 'confirmed', { id: admin.id, role: 'admin' })
  })

  it('requires admin authorization and validates own-delivery assignment details', async () => {
    const assignment = { method: 'shop', personName: 'Ravi Kumar', personPhone: '+919876543210' }
    const customerToken = await bearer(customer)
    const denied = await request(app)
      .patch(`/api/v1/orders/${createdOrder.id}/delivery`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send(assignment)
    expect(denied.status).toBe(403)
    expect(orders.assignDelivery).not.toHaveBeenCalled()

    const adminToken = await bearer(admin)
    const invalid = await request(app)
      .patch(`/api/v1/orders/${createdOrder.id}/delivery`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...assignment, personPhone: 'not-a-phone' })
    expect(invalid.status).toBe(400)
    expect(orders.assignDelivery).not.toHaveBeenCalled()

    const allowed = await request(app)
      .patch(`/api/v1/orders/${createdOrder.id}/delivery`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(assignment)
    expect(allowed.status).toBe(200)
    expect(orders.assignDelivery).toHaveBeenCalledWith(createdOrder.id, assignment, { id: admin.id, role: 'admin' })
  })

  it('accepts manual third-party details but never permits customer delivery-status writes', async () => {
    const adminToken = await bearer(admin)
    const assignment = {
      method: 'third_party',
      serviceName: 'Local courier',
      reference: 'LOCAL-123',
      details: 'Internal dispatch note',
    }
    const allowed = await request(app)
      .patch(`/api/v1/orders/${createdOrder.id}/delivery`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(assignment)
    expect(allowed.status).toBe(200)
    expect(orders.assignDelivery).toHaveBeenCalledWith(createdOrder.id, assignment, { id: admin.id, role: 'admin' })

    const customerToken = await bearer(customer)
    const denied = await request(app)
      .patch(`/api/v1/orders/${createdOrder.id}/delivery/status`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ status: 'in_transit' })
    expect(denied.status).toBe(403)
    expect(orders.updateDeliveryStatus).not.toHaveBeenCalled()

    const invalid = await request(app)
      .patch(`/api/v1/orders/${createdOrder.id}/delivery/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'delivered' })
    expect(invalid.status).toBe(400)
    expect(orders.updateDeliveryStatus).not.toHaveBeenCalled()
  })

  it('rejects invalid quantities and delivery methods', async () => {
    const token = await bearer(customer)
    for (const body of [
      { ...validOrder, items: [{ ...validOrder.items[0], quantity: 0 }] },
      { ...validOrder, deliveryMethod: 'courier-api' },
      { ...validOrder, address: { ...validOrder.address, postalCode: '123' } },
    ]) {
      const response = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
      expect(response.status).toBe(400)
    }
    expect(orders.create).not.toHaveBeenCalled()
  })
})
