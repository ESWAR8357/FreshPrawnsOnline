import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({
  findProduct: vi.fn(),
  findPrice: vi.fn(),
  findStock: vi.fn(),
  stockExists: vi.fn(),
  updateStock: vi.fn(),
  findOrder: vi.fn(),
  findOrderById: vi.fn(),
  findIncompleteOrders: vi.fn(),
  listOrders: vi.fn(),
  createOrder: vi.fn(),
  updateOrder: vi.fn(),
  updateOrderState: vi.fn(),
}))

vi.mock('../src/modules/products/product.model.js', () => ({
  Product: { findOne: database.findProduct },
}))
vi.mock('../src/modules/pricing/daily-price.model.js', () => ({
  DailyPrice: { findOne: database.findPrice },
}))
vi.mock('../src/modules/inventory/stock.model.js', () => ({
  Stock: {
    findOne: database.findStock,
    exists: database.stockExists,
    updateOne: database.updateStock,
  },
}))
vi.mock('../src/modules/orders/order.model.js', () => ({
  Order: {
    findOne: database.findOrder,
    findById: database.findOrderById,
    find: database.listOrders,
    create: database.createOrder,
    findOneAndUpdate: database.updateOrder,
    updateOne: database.updateOrderState,
  },
}))

import { MongoOrdersService, publicOrder } from '../src/modules/orders/orders.service.js'
import { Order } from '../src/modules/orders/order.model.js'
import { Stock } from '../src/modules/inventory/stock.model.js'

describe('Mongo order service', () => {
  const productId = new Types.ObjectId()
  const orderId = new Types.ObjectId()
  const service = new MongoOrdersService()
  const input = {
    idempotencyKey: 'cbd0edc0-536d-4c30-9b30-8f248822b128',
    customer: { name: 'Ananya Rao', phone: '+91 98765 43210' },
    address: { line: '12 Lake View Road', locality: 'Banjara Hills', postalCode: '500034' },
    deliveryMethod: 'shop' as const,
    items: [{ productSlug: 'white-prawns', preparation: 'cleaned' as const, weightGrams: 500 as const, quantity: 1 }],
  }
  const document = {
    _id: orderId,
    customerName: input.customer.name,
    customerPhone: input.customer.phone,
    address: { ...input.address, city: 'Hyderabad' },
    status: 'pending',
    stockReservationState: 'reserved',
    deliveryMethod: 'shop' as const,
    deliveryAssignment: {
      method: 'shop' as const,
      status: 'not_assigned' as const,
      details: 'Admin-only instructions',
    },
    items: [{
      productId,
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

  beforeEach(() => {
    vi.clearAllMocks()
    database.findOrder.mockReturnValue({ select: vi.fn().mockResolvedValue(null) })
    database.findIncompleteOrders.mockResolvedValue([])
    database.listOrders.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    })
    database.findOrderById.mockResolvedValue(document)
    database.findProduct.mockResolvedValue({
      _id: productId,
      name: 'White Prawns',
      preparationOptions: [
        { type: 'cleaned', enabled: true, feePaise: 4000 },
        { type: 'uncleaned', enabled: true, feePaise: 0 },
      ],
    })
    database.findPrice.mockReturnValue({ sort: vi.fn().mockResolvedValue({ pricePerKgPaise: 68000 }) })
    database.updateStock.mockResolvedValue({ modifiedCount: 1 })
    database.stockExists.mockResolvedValue(null)
    database.createOrder.mockResolvedValue(document)
    database.updateOrder.mockResolvedValue(document)
  })

  it('uses the database price, records an atomic order-owned stock reservation, and stores server totals', async () => {
    const result = await service.create('507f1f77bcf86cd799439011', input)

    expect(result.totalPaise).toBe(42000)
    expect(database.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      subtotalPaise: 38000,
      deliveryFeePaise: 4000,
      totalPaise: 42000,
      stockReservationState: 'reserving',
      items: [expect.objectContaining({ pricePerKgPaise: 68000, lineTotalPaise: 38000 })],
    }))
    expect(Stock.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        productId,
        'reservations.orderId': { $ne: orderId },
        $expr: {
          $gte: [{ $subtract: ['$onHandGrams', { $ifNull: ['$reservedGrams', 0] }] }, 500],
        },
      }),
      {
        $inc: { reservedGrams: 500 },
        $push: {
          reservations: { orderId, grams: 500 },
          movements: expect.objectContaining({
            operationId: `order:${orderId.toString()}:reserved`,
            deltaGrams: 0,
            reservedDeltaGrams: 500,
            reason: 'order_reserved',
          }),
        },
      },
    )
    expect(Order.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: orderId.toString(), stockReservationState: 'reserving' },
      { $set: { stockReservationState: 'reserved' } },
      { new: true },
    )
  })

  it('omits internal delivery notes from customer order responses', () => {
    const customerOrder = publicOrder(document)
    const adminOrder = publicOrder(document, true)

    expect(customerOrder.deliveryAssignment).toEqual({ method: 'shop', status: 'not_assigned' })
    expect(adminOrder.deliveryAssignment.details).toBe('Admin-only instructions')
  })

  it('returns owner-scoped order events without exposing actor identifiers', async () => {
    const createdAt = new Date('2026-03-20T10:01:00.000Z')
    const eventId = new Types.ObjectId()
    database.findOrder.mockReturnValue({
      select: vi.fn().mockResolvedValue({
        ...document,
        events: [{
          _id: eventId,
          type: 'order_status_changed',
          actorId: new Types.ObjectId(),
          actorRole: 'admin',
          from: 'pending',
          to: 'confirmed',
          createdAt,
        }],
      }),
    })

    await expect(service.listEvents(orderId.toString(), '507f1f77bcf86cd799439011', false)).resolves.toEqual([{
      id: eventId.toString(),
      type: 'order_status_changed',
      actorRole: 'admin',
      from: 'pending',
      to: 'confirmed',
      createdAt,
    }])
    expect(database.findOrder).toHaveBeenCalledWith({
      _id: orderId.toString(),
      customerUserId: '507f1f77bcf86cd799439011',
      stockReservationState: { $in: ['reserved', 'released', 'consumed'] },
    })
  })

  it('paginates customer order history with a stable created-time and id cursor', async () => {
    const first = { ...document, _id: new Types.ObjectId(), createdAt: new Date('2026-03-20T12:00:00.000Z') }
    const second = { ...document, _id: new Types.ObjectId(), createdAt: new Date('2026-03-20T11:00:00.000Z') }
    const extra = { ...document, _id: new Types.ObjectId(), createdAt: new Date('2026-03-20T10:00:00.000Z') }
    database.listOrders.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([first, second, extra]),
    })

    const page = await service.listForCustomer('507f1f77bcf86cd799439011', { limit: 2 })

    expect(page.items).toHaveLength(2)
    expect(page.nextCursor).toBeTruthy()
    expect(database.listOrders).toHaveBeenCalledWith(expect.objectContaining({
      customerUserId: '507f1f77bcf86cd799439011',
      stockReservationState: { $in: ['reserved', 'released', 'consumed'] },
    }))
    await service.listForCustomer('507f1f77bcf86cd799439011', { limit: 2, cursor: page.nextCursor as string })
    const cursorQuery = database.listOrders.mock.calls.at(-1)?.[0]
    expect(cursorQuery).toEqual(expect.objectContaining({
      customerUserId: '507f1f77bcf86cd799439011',
      $or: [
        { createdAt: { $lt: second.createdAt } },
        { createdAt: second.createdAt, _id: { $lt: second._id } },
      ],
    }))
  })

  it('records an admin actor with each successful order status transition', async () => {
    database.findOrderById.mockResolvedValue(document)
    await service.updateStatus(orderId.toString(), 'confirmed', {
      id: '507f1f77bcf86cd799439014',
      role: 'admin',
    })
    expect(database.updateOrder).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' }),
      expect.objectContaining({
        $push: { events: expect.objectContaining({
          type: 'order_status_changed',
          actorRole: 'admin',
          from: 'pending',
          to: 'confirmed',
        }) },
      }),
      { new: true, runValidators: true },
    )
  })

  it('requires an assignment before dispatch and rejects invalid delivery status changes', async () => {
    database.findOrderById.mockResolvedValue({
      ...document,
      status: 'preparing',
      deliveryAssignment: { ...document.deliveryAssignment, status: 'not_assigned' },
    })
    await expect(service.updateStatus(orderId.toString(), 'out_for_delivery'))
      .rejects.toMatchObject({ code: 'DELIVERY_NOT_ASSIGNED' })

    database.findOrderById.mockResolvedValue({
      ...document,
      status: 'preparing',
      deliveryAssignment: { ...document.deliveryAssignment, status: 'assigned' },
    })
    await expect(service.updateDeliveryStatus(orderId.toString(), 'delivered'))
      .rejects.toMatchObject({ code: 'INVALID_DELIVERY_STATUS_TRANSITION' })
    expect(database.updateOrder).not.toHaveBeenCalled()
  })

  it('stores shop assignments and manual third-party details on the order', async () => {
    const shopAssignment = { method: 'shop' as const, personName: 'Ravi Kumar', personPhone: '+919876543210' }
    await service.assignDelivery(orderId.toString(), shopAssignment)
    expect(database.updateOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: orderId,
        status: 'pending',
        'deliveryAssignment.status': { $in: ['not_assigned', null] },
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          deliveryMethod: 'shop',
          'deliveryAssignment.method': 'shop',
          'deliveryAssignment.status': 'assigned',
          'deliveryAssignment.personName': 'Ravi Kumar',
          'deliveryAssignment.personPhone': '+919876543210',
        }),
      }),
      { new: true, runValidators: true },
    )

    database.findOrderById.mockResolvedValue({
      ...document,
      deliveryAssignment: { method: 'third_party', status: 'not_assigned' },
    })
    await service.assignDelivery(orderId.toString(), {
      method: 'third_party',
      serviceName: 'Local courier',
      reference: 'LOCAL-123',
      details: 'Admin-only note',
    })
    expect(database.updateOrder).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $set: expect.objectContaining({
          'deliveryAssignment.serviceName': 'Local courier',
          'deliveryAssignment.reference': 'LOCAL-123',
          'deliveryAssignment.details': 'Admin-only note',
        }),
        $unset: expect.objectContaining({
          'deliveryAssignment.personName': 1,
          'deliveryAssignment.personPhone': 1,
        }),
      }),
      { new: true, runValidators: true },
    )
  })

  it('validates delivery progress changes and synchronizes dispatch progress', async () => {
    database.findOrderById.mockResolvedValue({
      ...document,
      status: 'preparing',
      deliveryAssignment: { ...document.deliveryAssignment, status: 'assigned' },
    })
    await service.updateDeliveryStatus(orderId.toString(), 'in_transit')
    expect(database.updateOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: orderId,
        status: 'preparing',
        'deliveryAssignment.status': 'assigned',
      }),
      expect.objectContaining({
        $set: { 'deliveryAssignment.status': 'in_transit' },
        $push: { events: expect.objectContaining({
          type: 'delivery_status_changed',
          from: 'assigned',
          to: 'in_transit',
        }) },
      }),
      { new: true, runValidators: true },
    )

    database.findOrderById.mockResolvedValue({
      ...document,
      status: 'out_for_delivery',
      deliveryAssignment: { ...document.deliveryAssignment, status: 'exception' },
    })
    await expect(service.updateStatus(orderId.toString(), 'delivered'))
      .rejects.toMatchObject({ code: 'DELIVERY_NOT_IN_TRANSIT' })
  })

  it('rejects insufficient stock and rolls back any earlier item reservations', async () => {
    const secondProductId = new Types.ObjectId()
    database.findProduct.mockImplementation(async ({ slug }: { slug: string }) => ({
      _id: slug === 'white-prawns' ? productId : secondProductId,
      name: slug,
      preparationOptions: [{ type: 'uncleaned', enabled: true, feePaise: 0 }],
    }))
    const secondInput = {
      ...input,
      items: [
        { ...input.items[0], preparation: 'uncleaned' as const },
        { productSlug: 'tiger-prawns', preparation: 'uncleaned' as const, weightGrams: 500 as const, quantity: 1 },
      ],
    }
    database.updateStock
      .mockResolvedValueOnce({ modifiedCount: 1 })
      .mockResolvedValueOnce({ modifiedCount: 0 })
      .mockResolvedValueOnce({ modifiedCount: 1 })
      .mockResolvedValueOnce({ modifiedCount: 0 })
    database.findStock.mockResolvedValue(null)
    database.updateOrderState.mockResolvedValue({ acknowledged: true, matchedCount: 1, modifiedCount: 1 })

    await expect(service.create('507f1f77bcf86cd799439011', secondInput))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK', status: 409 })

    expect(Stock.updateOne).toHaveBeenCalledTimes(4)
    expect(database.updateStock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        productId: secondProductId,
        reservations: { $elemMatch: { orderId, grams: 500 } },
      }),
      expect.objectContaining({ $inc: { reservedGrams: -500 } }),
    )
  })

  it('resumes durable reservations left incomplete by a process interruption', async () => {
    database.listOrders.mockResolvedValue([{ ...document, stockReservationState: 'reserving' }])

    await service.recoverIncompleteOperations()

    expect(Stock.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ 'reservations.orderId': { $ne: orderId } }),
      expect.objectContaining({
        $push: {
          reservations: { orderId, grams: 500 },
          movements: expect.objectContaining({ reason: 'order_reserved', reservedDeltaGrams: 500 }),
        },
      }),
    )
    expect(Order.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: orderId.toString(), stockReservationState: 'reserving' },
      { $set: { stockReservationState: 'reserved' } },
      { new: true },
    )
  })
})
