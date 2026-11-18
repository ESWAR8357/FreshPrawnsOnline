import { createHash } from 'node:crypto'
import { Types } from 'mongoose'
import { HttpError } from '../../http-error.js'
import { DailyPrice } from '../pricing/daily-price.model.js'
import { Product } from '../products/product.model.js'
import { Stock } from '../inventory/stock.model.js'
import { Order } from './order.model.js'

export type OrderInput = {
  idempotencyKey: string
  customer: { name: string; phone: string }
  address: { line: string; locality: string; postalCode: string }
  deliveryMethod: 'shop' | 'third_party'
  items: Array<{
    productSlug: string
    preparation: 'cleaned' | 'uncleaned'
    weightGrams: 250 | 500 | 1000
    quantity: number
  }>
}

export type OrderActor = { id: string; role: 'customer' | 'admin' }
export type OrderEventActor = { id: string; role: 'admin' | 'system' }

export type DeliveryAssignmentInput =
  | { method: 'shop'; personName: string; personPhone: string }
  | { method: 'third_party'; serviceName: string; reference?: string; details?: string }

const DELIVERY_FEE_PAISE = { shop: 4000, third_party: 6000 } as const
const MAX_ORDER_EVENTS = 500

function assertEventCapacity(order: { events?: unknown[] }) {
  if ((order.events?.length ?? 0) >= MAX_ORDER_EVENTS) {
    throw new HttpError(409, 'ORDER_EVENT_LIMIT_REACHED', 'This order has reached its event history limit')
  }
}

export function calculateOrderLineTotalPaise(
  pricePerKgPaise: number,
  preparationFeePaise: number,
  weightGrams: number,
  quantity: number,
): number {
  const productCostPaise = Math.round(pricePerKgPaise * weightGrams / 1000)
  const lineTotalPaise = (productCostPaise + preparationFeePaise) * quantity
  if (!Number.isSafeInteger(lineTotalPaise)) {
    throw new HttpError(400, 'ORDER_TOTAL_TOO_LARGE', 'Order total exceeds the supported limit')
  }
  return lineTotalPaise
}

type OrderRecord = {
  _id: Types.ObjectId
  customerName: string
  customerPhone: string
  address?: { line: string; locality: string; city: string; postalCode?: string | null } | null
  status: string
  stockReservationState: string
  reservationTargetStatus?: string | null
  deliveryMethod: 'shop' | 'third_party'
  deliveryAssignment?: {
    method: 'shop' | 'third_party'
    status: 'not_assigned' | 'assigned' | 'picked_up' | 'in_transit' | 'exception' | 'delivered' | 'cancelled'
    personName?: string | null
    personPhone?: string | null
    serviceName?: string | null
    reference?: string | null
    details?: string | null
  } | null
  items: Array<{
    productId?: Types.ObjectId | null
    productName: string
    preparation: 'cleaned' | 'uncleaned'
    weightGrams: number
    quantity: number
    pricePerKgPaise: number
    preparationFeePaise: number
    lineTotalPaise: number
  }>
  subtotalPaise: number
  deliveryFeePaise: number
  totalPaise: number
  createdAt: Date
}

type PublicOrder = {
  id: string
  customerName: string
  customerPhone: string
  address: { line: string; locality: string; city: string; postalCode: string }
  status: string
  deliveryMethod: 'shop' | 'third_party'
  deliveryAssignment: {
    method: 'shop' | 'third_party'
    status: string
    personName?: string
    personPhone?: string
    serviceName?: string
    reference?: string
    details?: string
  }
  items: OrderRecord['items']
  subtotalPaise: number
  deliveryFeePaise: number
  totalPaise: number
  createdAt: Date
}

export type CustomerOrderFilters = {
  limit: number
  cursor?: string
  status?: 'pending' | 'confirmed' | 'preparing' | 'out_for_delivery' | 'delivered' | 'cancelled'
  from?: Date
  to?: Date
}

function decodeOrderCursor(cursor: string): { createdAt: Date; id: Types.ObjectId } {
  try {
    const [timestamp, id, ...extra] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
    const createdAt = new Date(timestamp)
    if (extra.length || !Number.isFinite(createdAt.getTime()) || !Types.ObjectId.isValid(id)) throw new Error()
    return { createdAt, id: new Types.ObjectId(id) }
  } catch {
    throw new HttpError(400, 'INVALID_ORDER_CURSOR', 'Order history cursor is invalid')
  }
}

function encodeOrderCursor(order: { createdAt: Date; _id: Types.ObjectId }): string {
  return Buffer.from(`${order.createdAt.toISOString()}|${order._id.toString()}`).toString('base64url')
}

function requestFingerprint(input: OrderInput): string {
  const content = {
    customer: input.customer,
    address: input.address,
    deliveryMethod: input.deliveryMethod,
    items: input.items,
  }
  return createHash('sha256').update(JSON.stringify(content)).digest('hex')
}

export function publicOrder(order: OrderRecord, includeInternalDeliveryDetails = false): PublicOrder {
  if (!order.address?.line || !order.address.locality || !order.address.city || !order.address.postalCode) {
    throw new Error('Stored order is missing its required delivery address')
  }
  const assignment = order.deliveryAssignment
  const legacyDeliveryStatus = order.status === 'out_for_delivery'
    ? 'in_transit'
    : order.status === 'delivered'
      ? 'delivered'
      : order.status === 'cancelled'
        ? 'cancelled'
        : 'not_assigned'
  const deliveryAssignment: PublicOrder['deliveryAssignment'] = {
    method: assignment?.method ?? order.deliveryMethod,
    status: assignment?.status ?? legacyDeliveryStatus,
  }
  if (deliveryAssignment.method === 'shop') {
    if (assignment?.personName) deliveryAssignment.personName = assignment.personName
    if (assignment?.personPhone) deliveryAssignment.personPhone = assignment.personPhone
  } else {
    if (assignment?.serviceName) deliveryAssignment.serviceName = assignment.serviceName
    if (assignment?.reference) deliveryAssignment.reference = assignment.reference
  }
  if (includeInternalDeliveryDetails && assignment?.details) {
    deliveryAssignment.details = assignment.details
  }
  return {
    id: order._id.toString(),
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    address: {
      line: order.address.line,
      locality: order.address.locality,
      city: order.address.city,
      postalCode: order.address.postalCode,
    },
    status: order.status,
    deliveryMethod: deliveryAssignment.method,
    deliveryAssignment,
    items: order.items.map((item) => ({
      productName: item.productName,
      preparation: item.preparation,
      weightGrams: item.weightGrams,
      quantity: item.quantity,
      pricePerKgPaise: item.pricePerKgPaise,
      preparationFeePaise: item.preparationFeePaise,
      lineTotalPaise: item.lineTotalPaise,
    })),
    subtotalPaise: order.subtotalPaise,
    deliveryFeePaise: order.deliveryFeePaise,
    totalPaise: order.totalPaise,
    createdAt: order.createdAt,
  }
}

export interface OrdersService {
  create(customerId: string, input: OrderInput): Promise<PublicOrder>
  listForCustomer(customerId: string, filters: CustomerOrderFilters): Promise<{ items: PublicOrder[]; nextCursor: string | null }>
  listForAdmin(): Promise<PublicOrder[]>
  getById(orderId: string, customerId: string, isAdmin: boolean): Promise<PublicOrder>
  listEvents(orderId: string, customerId: string, isAdmin: boolean): Promise<Array<{
    id: string
    type: string
    actorRole: string
    from: string | null
    to: string | null
    createdAt: Date
  }>>
  updateStatus(orderId: string, status: string, actor?: OrderEventActor): Promise<PublicOrder>
  assignDelivery(orderId: string, input: DeliveryAssignmentInput, actor?: OrderEventActor): Promise<PublicOrder>
  updateDeliveryStatus(orderId: string, status: string, actor?: OrderEventActor): Promise<PublicOrder>
  recoverIncompleteOperations(): Promise<void>
}

export class MongoOrdersService implements OrdersService {
  async recoverIncompleteOperations(): Promise<void> {
    const incompleteOrders = await Order.find({
      stockReservationState: { $in: ['reserving', 'releasing', 'consuming'] },
    })
    for (const order of incompleteOrders) {
      if (order.stockReservationState === 'reserving') {
        try {
          await this.completeStockReservation(
            order._id.toString(),
            this.reservationTotals(order.items),
          )
        } catch (error) {
          if (!(error instanceof HttpError && error.code === 'INSUFFICIENT_STOCK')) throw error
        }
        continue
      }
      if (order.reservationTargetStatus !== 'cancelled' && order.reservationTargetStatus !== 'delivered') {
        throw new HttpError(500, 'STOCK_RECONCILIATION_REQUIRED', `Order ${order._id.toString()} has no valid stock-transition target`)
      }
      await this.updateStatus(order._id.toString(), order.reservationTargetStatus)
    }
  }

  async create(customerId: string, input: OrderInput) {
    const fingerprint = requestFingerprint(input)
    const idempotencyKey = createHash('sha256')
      .update(`${customerId}:${input.idempotencyKey}`)
      .digest('hex')
    const priorOrder = await Order.findOne({ idempotencyKey }).select('+idempotencyKey +requestFingerprint')
    if (priorOrder) {
      if (priorOrder.requestFingerprint !== fingerprint) {
        throw new HttpError(409, 'IDEMPOTENCY_KEY_REUSED', 'Use a new idempotency key for different order details')
      }
      if (priorOrder.stockReservationState === 'reserving') {
        const completed = await this.completeStockReservation(
          priorOrder._id.toString(),
          this.reservationTotals(priorOrder.items),
        )
        return publicOrder(completed)
      }
      if (priorOrder.stockReservationState !== 'reserved') {
        throw new HttpError(409, 'ORDER_NO_LONGER_ACTIVE', 'This order is no longer available for submission')
      }
      return publicOrder(priorOrder)
    }

    const now = new Date()
    const items: Array<Record<string, unknown>> = []
    const reservations = new Map<string, number>()
    let subtotalPaise = 0

    for (const requested of input.items) {
      const product = await Product.findOne({ slug: requested.productSlug, active: true })
      if (!product) throw new HttpError(400, 'PRODUCT_UNAVAILABLE', 'A selected product is no longer available')
      const option = product.preparationOptions.find(({ type, enabled }) => type === requested.preparation && enabled)
      if (!option) throw new HttpError(400, 'PREPARATION_UNAVAILABLE', `${product.name} is not available with the selected preparation`)
      const price = await DailyPrice.findOne({
        productId: product._id,
        effectiveFrom: { $lte: now },
        $or: [{ effectiveTo: null }, { effectiveTo: { $gt: now } }],
      }).sort({ effectiveFrom: -1 })
      if (!price) throw new HttpError(409, 'PRICE_UNAVAILABLE', `A current price is not set for ${product.name}`)

      const lineTotalPaise = calculateOrderLineTotalPaise(
        price.pricePerKgPaise,
        option.feePaise,
        requested.weightGrams,
        requested.quantity,
      )
      subtotalPaise += lineTotalPaise
      if (!Number.isSafeInteger(subtotalPaise)) throw new HttpError(400, 'ORDER_TOTAL_TOO_LARGE', 'Order total exceeds the supported limit')
      const productId = product._id.toString()
      reservations.set(productId, (reservations.get(productId) ?? 0) + requested.weightGrams * requested.quantity)
      items.push({
        productId: product._id,
        productName: product.name,
        preparation: requested.preparation,
        weightGrams: requested.weightGrams,
        quantity: requested.quantity,
        pricePerKgPaise: price.pricePerKgPaise,
        preparationFeePaise: option.feePaise,
        lineTotalPaise,
      })
    }

    const deliveryFeePaise = DELIVERY_FEE_PAISE[input.deliveryMethod]
    const totalPaise = subtotalPaise + deliveryFeePaise
    if (!Number.isSafeInteger(totalPaise)) {
      throw new HttpError(400, 'ORDER_TOTAL_TOO_LARGE', 'Order total exceeds the supported limit')
    }

    let order
    try {
      order = await Order.create({
        customerUserId: customerId,
        customerName: input.customer.name,
        customerPhone: input.customer.phone,
        address: { ...input.address, city: 'Hyderabad' },
        status: 'pending',
        stockReservationState: 'reserving',
        deliveryMethod: input.deliveryMethod,
        deliveryAssignment: { method: input.deliveryMethod, status: 'not_assigned' },
        items,
        subtotalPaise,
        deliveryFeePaise,
        totalPaise,
        idempotencyKey,
        requestFingerprint: fingerprint,
        events: [{
          type: 'order_status_changed',
          actorId: new Types.ObjectId(customerId),
          actorRole: 'customer',
          from: null,
          to: 'pending',
          createdAt: now,
        }],
      })
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
        const duplicate = await Order.findOne({ idempotencyKey }).select('+idempotencyKey +requestFingerprint')
        if (duplicate?.requestFingerprint !== fingerprint) {
          throw new HttpError(409, 'IDEMPOTENCY_KEY_REUSED', 'Use a new idempotency key for different order details')
        }
        if (duplicate.stockReservationState === 'reserved') return publicOrder(duplicate)
        if (duplicate.stockReservationState !== 'reserving') {
          throw new HttpError(409, 'ORDER_NO_LONGER_ACTIVE', 'This order is no longer available for submission')
        }
        order = duplicate
      } else {
        throw error
      }
    }

    const completed = await this.completeStockReservation(order._id.toString(), reservations)
    return publicOrder(completed)
  }

  async listForCustomer(customerId: string, filters: CustomerOrderFilters) {
    const query: Record<string, unknown> = {
      customerUserId: customerId,
      stockReservationState: { $in: ['reserved', 'released', 'consumed'] },
    }
    if (filters.status) query.status = filters.status
    if (filters.from || filters.to) {
      query.createdAt = {
        ...(filters.from ? { $gte: filters.from } : {}),
        ...(filters.to ? { $lt: filters.to } : {}),
      }
    }
    if (filters.cursor) {
      const cursor = decodeOrderCursor(filters.cursor)
      query.$or = [
        { createdAt: { ...(filters.from ? { $gte: filters.from } : {}), $lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
      ]
    }
    const orders = await Order.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(filters.limit + 1)
    const hasMore = orders.length > filters.limit
    const page = hasMore ? orders.slice(0, filters.limit) : orders
    return {
      items: page.map((order) => publicOrder(order)),
      nextCursor: hasMore && page.length ? encodeOrderCursor(page[page.length - 1]) : null,
    }
  }

  async listForAdmin() {
    const orders = await Order.find().sort({ createdAt: -1 }).limit(100)
    return orders.map((order) => publicOrder(order, true))
  }

  async getById(orderId: string, customerId: string, isAdmin: boolean) {
    const filter = isAdmin
      ? { _id: orderId }
      : {
          _id: orderId,
          customerUserId: customerId,
          stockReservationState: { $in: ['reserved', 'released', 'consumed'] },
        }
    const order = await Order.findOne(filter)
    if (!order) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found')
    return publicOrder(order, isAdmin)
  }

  async listEvents(orderId: string, customerId: string, isAdmin: boolean) {
    const filter = isAdmin
      ? { _id: orderId }
      : {
          _id: orderId,
          customerUserId: customerId,
          stockReservationState: { $in: ['reserved', 'released', 'consumed'] },
        }
    const order = await Order.findOne(filter).select('events')
    if (!order) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found')
    return order.events.map((event) => ({
      id: event._id.toString(),
      type: event.type,
      actorRole: event.actorRole,
      from: event.from ?? null,
      to: event.to ?? null,
      createdAt: event.createdAt,
    }))
  }

  async updateStatus(orderId: string, status: string, actor: OrderEventActor = { id: '', role: 'system' }) {
    let current = await Order.findById(orderId)
    if (!current) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found')
    if (current.status === status) return publicOrder(current)
    assertEventCapacity(current)
    const allowed: Record<string, string[]> = {
      pending: ['confirmed', 'cancelled'],
      confirmed: ['preparing', 'cancelled'],
      preparing: ['out_for_delivery', 'cancelled'],
      out_for_delivery: ['delivered'],
      delivered: [],
      cancelled: [],
    }
    if (!allowed[current.status]?.includes(status)) {
      throw new HttpError(409, 'INVALID_STATUS_TRANSITION', `Cannot change order status from ${current.status} to ${status}`)
    }
    if (status === 'out_for_delivery'
      && !['assigned', 'picked_up', 'in_transit'].includes(current.deliveryAssignment?.status ?? 'not_assigned')) {
      throw new HttpError(409, 'DELIVERY_NOT_ASSIGNED', 'Assign a delivery person or method before sending the order out')
    }
    if (status === 'delivered' && current.deliveryAssignment && current.deliveryAssignment.status !== 'in_transit') {
      throw new HttpError(409, 'DELIVERY_NOT_IN_TRANSIT', 'Delivery must be in transit before completing the order')
    }

    if (status !== 'cancelled' && status !== 'delivered') {
      const updated = await Order.findOneAndUpdate(
        { _id: current._id, status: current.status, stockReservationState: 'reserved' },
        {
          $set: {
          status,
          ...(status === 'out_for_delivery' ? { 'deliveryAssignment.status': 'in_transit' } : {}),
          },
          $push: {
            events: {
              type: 'order_status_changed',
              actorId: actor.id ? new Types.ObjectId(actor.id) : null,
              actorRole: actor.role,
              from: current.status,
              to: status,
              createdAt: new Date(),
            },
          },
        },
        { new: true, runValidators: true },
      )
      if (!updated) throw new HttpError(409, 'ORDER_STATUS_CHANGED', 'Order status changed; reload and try again')
      return publicOrder(updated, true)
    }

    const processingState = status === 'cancelled' ? 'releasing' : 'consuming'
    const finalState = status === 'cancelled' ? 'released' : 'consumed'
    if (current.stockReservationState === 'reserved') {
      const lockedOrder = await Order.findOneAndUpdate(
        { _id: current._id, status: current.status, stockReservationState: 'reserved' },
        { $set: { stockReservationState: processingState, reservationTargetStatus: status } },
        { new: true },
      )
      if (!lockedOrder) {
        const latest = await Order.findById(current._id)
        if (latest?.status === status) return publicOrder(latest, true)
        throw new HttpError(409, 'ORDER_STATUS_CHANGED', 'Order status changed; reload and try again')
      }
      current = lockedOrder
    } else if (current.stockReservationState !== processingState || current.reservationTargetStatus !== status) {
      if (current.status === status) return publicOrder(current, true)
      throw new HttpError(409, 'ORDER_STATUS_CHANGED', 'Another order stock update is in progress')
    }

    const reservations = this.reservationTotals(current.items)
    if (status === 'cancelled') await this.releaseReservations(current._id.toString(), reservations)
    else await this.consumeReservations(current._id.toString(), reservations)
    const updated = await Order.findOneAndUpdate(
      {
        _id: current._id,
        status: current.status,
        stockReservationState: processingState,
        reservationTargetStatus: status,
      },
      {
        $set: {
          status,
          stockReservationState: finalState,
          ...(current.deliveryAssignment
            ? { 'deliveryAssignment.status': status === 'cancelled' ? 'cancelled' : 'delivered' }
            : {}),
        },
        $push: {
          events: {
            type: 'order_status_changed',
            actorId: actor.id ? new Types.ObjectId(actor.id) : null,
            actorRole: actor.role,
            from: current.status,
            to: status,
            createdAt: new Date(),
          },
        },
        $unset: { reservationTargetStatus: 1 },
      },
      { new: true, runValidators: true },
    )
    if (!updated) {
      const latest = await Order.findById(current._id)
      if (latest?.status === status) return publicOrder(latest, true)
      throw new HttpError(409, 'ORDER_STATUS_CHANGED', 'Order stock changed; reload and reconcile before retrying')
    }
    return publicOrder(updated, true)
  }

  async assignDelivery(orderId: string, input: DeliveryAssignmentInput, actor: OrderEventActor = { id: '', role: 'system' }) {
    const current = await Order.findById(orderId)
    if (!current) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found')
    assertEventCapacity(current)
    if (['delivered', 'cancelled', 'out_for_delivery'].includes(current.status)) {
      throw new HttpError(409, 'DELIVERY_ASSIGNMENT_LOCKED', 'Delivery details cannot be changed after dispatch or order completion')
    }
    const currentDeliveryStatus = current.deliveryAssignment?.status ?? 'not_assigned'
    if (!['not_assigned', 'assigned'].includes(currentDeliveryStatus)) {
      throw new HttpError(409, 'DELIVERY_ASSIGNMENT_LOCKED', 'Delivery details cannot be changed after handoff')
    }
    const assignmentFields = input.method === 'shop'
      ? {
          'deliveryAssignment.personName': input.personName,
          'deliveryAssignment.personPhone': input.personPhone,
        }
      : {
          'deliveryAssignment.serviceName': input.serviceName,
          ...(input.reference ? { 'deliveryAssignment.reference': input.reference } : {}),
          ...(input.details ? { 'deliveryAssignment.details': input.details } : {}),
        }
    const unsetFields = input.method === 'shop'
      ? {
          'deliveryAssignment.serviceName': 1,
          'deliveryAssignment.reference': 1,
          'deliveryAssignment.details': 1,
        }
      : {
          'deliveryAssignment.personName': 1,
          'deliveryAssignment.personPhone': 1,
        }
    const updated = await Order.findOneAndUpdate(
      {
        _id: current._id,
        status: current.status,
        'deliveryAssignment.status': { $in: [currentDeliveryStatus, null] },
      },
      {
        $set: {
          deliveryMethod: input.method,
          'deliveryAssignment.method': input.method,
          'deliveryAssignment.status': 'assigned',
          ...assignmentFields,
        },
        $push: {
          events: {
            type: 'delivery_assigned',
            actorId: actor.id ? new Types.ObjectId(actor.id) : null,
            actorRole: actor.role,
            from: current.deliveryAssignment?.method ?? null,
            to: input.method,
            createdAt: new Date(),
          },
        },
        $unset: unsetFields,
      },
      { new: true, runValidators: true },
    )
    if (!updated) throw new HttpError(409, 'DELIVERY_ASSIGNMENT_CHANGED', 'Delivery assignment changed; reload and try again')
    return publicOrder(updated, true)
  }

  async updateDeliveryStatus(orderId: string, status: string, actor: OrderEventActor = { id: '', role: 'system' }) {
    const current = await Order.findById(orderId)
    if (!current) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found')
    assertEventCapacity(current)
    if (['delivered', 'cancelled'].includes(current.status)) {
      throw new HttpError(409, 'DELIVERY_STATUS_LOCKED', 'Delivery status follows the completed or cancelled order')
    }
    if (!['preparing', 'out_for_delivery'].includes(current.status)) {
      throw new HttpError(409, 'ORDER_NOT_READY_FOR_DELIVERY', 'Delivery progress can begin after order preparation')
    }
    const currentDeliveryStatus = current.deliveryAssignment?.status ?? 'not_assigned'
    const allowed: Record<string, string[]> = {
      assigned: ['picked_up', 'in_transit', 'exception'],
      picked_up: ['in_transit', 'exception'],
      in_transit: ['exception'],
      exception: ['assigned', 'picked_up', 'in_transit'],
    }
    if (!allowed[currentDeliveryStatus]?.includes(status)) {
      throw new HttpError(409, 'INVALID_DELIVERY_STATUS_TRANSITION', `Cannot change delivery status from ${currentDeliveryStatus} to ${status}`)
    }
    const updated = await Order.findOneAndUpdate(
      {
        _id: current._id,
        status: current.status,
        'deliveryAssignment.status': currentDeliveryStatus,
      },
      {
        $set: { 'deliveryAssignment.status': status },
        $push: {
          events: {
            type: 'delivery_status_changed',
            actorId: actor.id ? new Types.ObjectId(actor.id) : null,
            actorRole: actor.role,
            from: currentDeliveryStatus,
            to: status,
            createdAt: new Date(),
          },
        },
      },
      { new: true, runValidators: true },
    )
    if (!updated) throw new HttpError(409, 'DELIVERY_STATUS_CHANGED', 'Delivery status changed; reload and try again')
    return publicOrder(updated, true)
  }

  private reservationTotals(items: OrderRecord['items']): Map<string, number> {
    const totals = new Map<string, number>()
    for (const item of items) {
      if (!item.productId) throw new HttpError(409, 'STOCK_RECONCILIATION_REQUIRED', 'Order is missing its product reference')
      const id = item.productId.toString()
      totals.set(id, (totals.get(id) ?? 0) + item.weightGrams * item.quantity)
    }
    return totals
  }

  private async reserveStock(orderId: string, reservations: Map<string, number>): Promise<void> {
    const orderObjectId = new Types.ObjectId(orderId)
    for (const [id, grams] of reservations) {
      const productId = new Types.ObjectId(id)
      const result = await Stock.updateOne(
        {
          productId,
          'reservations.orderId': { $ne: orderObjectId },
          $expr: {
            $gte: [{ $subtract: ['$onHandGrams', { $ifNull: ['$reservedGrams', 0] }] }, grams],
          },
        },
        {
          $inc: { reservedGrams: grams },
          $push: {
            reservations: { orderId: orderObjectId, grams },
            movements: {
              operationId: `order:${orderId}:reserved`,
              actorId: null,
              orderId: orderObjectId,
              deltaGrams: 0,
              reservedDeltaGrams: grams,
              reason: 'order_reserved',
              createdAt: new Date(),
            },
          },
        },
      )
      if (result.modifiedCount === 1) continue
      const existing = await Stock.findOne({ productId, 'reservations.orderId': orderObjectId })
      if (existing?.reservations.some((reservation) => reservation.orderId.equals(orderObjectId) && reservation.grams === grams)) continue
      throw new HttpError(409, 'INSUFFICIENT_STOCK', 'One or more selections no longer have enough stock')
    }
  }

  private async completeStockReservation(orderId: string, reservations: Map<string, number>) {
    try {
      await this.reserveStock(orderId, reservations)
      const completed = await Order.findOneAndUpdate(
        { _id: orderId, stockReservationState: 'reserving' },
        { $set: { stockReservationState: 'reserved' } },
        { new: true },
      )
      if (!completed) {
        const existing = await Order.findById(orderId)
        if (existing?.stockReservationState === 'reserved') return existing
        throw new Error('Order disappeared while completing stock reservation')
      }
      return completed
    } catch (error) {
      if (error instanceof HttpError && error.code === 'INSUFFICIENT_STOCK') {
        await this.releaseReservations(orderId, reservations)
        await Order.updateOne(
          { _id: orderId, stockReservationState: 'reserving' },
          {
            $set: { stockReservationState: 'released', status: 'cancelled' },
            $push: {
              events: {
                type: 'order_status_changed',
                actorId: null,
                actorRole: 'system',
                from: 'pending',
                to: 'cancelled',
                createdAt: new Date(),
              },
            },
          },
        )
      }
      throw error
    }
  }

  private async releaseReservations(orderId: string, reservations: Map<string, number>): Promise<void> {
    const orderObjectId = new Types.ObjectId(orderId)
    for (const [id, grams] of reservations) {
      const productId = new Types.ObjectId(id)
      const result = await Stock.updateOne(
        {
          productId,
          reservedGrams: { $gte: grams },
          reservations: { $elemMatch: { orderId: orderObjectId, grams } },
        },
        {
          $inc: { reservedGrams: -grams },
          $pull: { reservations: { orderId: orderObjectId, grams } },
          $push: {
            movements: {
              operationId: `order:${orderId}:released`,
              actorId: null,
              orderId: orderObjectId,
              deltaGrams: 0,
              reservedDeltaGrams: -grams,
              reason: 'order_released',
              createdAt: new Date(),
            },
          },
        },
      )
      if (result.modifiedCount === 1) continue
      const stillReserved = await Stock.exists({ productId, 'reservations.orderId': orderObjectId })
      if (stillReserved) throw new HttpError(409, 'STOCK_RECONCILIATION_REQUIRED', 'Order stock reservation does not match inventory')
    }
  }

  private async consumeReservations(orderId: string, reservations: Map<string, number>): Promise<void> {
    const orderObjectId = new Types.ObjectId(orderId)
    for (const [id, grams] of reservations) {
      const productId = new Types.ObjectId(id)
      const result = await Stock.updateOne(
        {
          productId,
          onHandGrams: { $gte: grams },
          reservedGrams: { $gte: grams },
          reservations: { $elemMatch: { orderId: orderObjectId, grams } },
        },
        {
          $inc: { onHandGrams: -grams, reservedGrams: -grams },
          $pull: { reservations: { orderId: orderObjectId, grams } },
          $push: {
            movements: {
              operationId: `order:${orderId}:fulfilled`,
              actorId: null,
              orderId: orderObjectId,
              deltaGrams: -grams,
              reservedDeltaGrams: -grams,
              reason: 'order_fulfilled',
              createdAt: new Date(),
            },
          },
        },
      )
      if (result.modifiedCount === 1) continue
      const stillReserved = await Stock.exists({ productId, 'reservations.orderId': orderObjectId })
      if (stillReserved) throw new HttpError(409, 'STOCK_RECONCILIATION_REQUIRED', 'Order stock reservation does not match inventory')
    }
  }
}
