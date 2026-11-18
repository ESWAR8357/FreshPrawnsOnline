import { Schema, model } from 'mongoose'

const orderItemSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  productName: { type: String, required: true, trim: true },
  preparation: { type: String, enum: ['cleaned', 'uncleaned'], required: true },
  weightGrams: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  pricePerKgPaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  preparationFeePaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger, default: 0 },
  lineTotalPaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
}, { _id: false })

const deliveryAssignmentSchema = new Schema({
  method: { type: String, enum: ['shop', 'third_party'], required: true },
  status: {
    type: String,
    enum: ['not_assigned', 'assigned', 'picked_up', 'in_transit', 'exception', 'delivered', 'cancelled'],
    required: true,
    default: 'not_assigned',
  },
  personName: { type: String, trim: true, maxlength: 120 },
  personPhone: { type: String, trim: true, maxlength: 32 },
  serviceName: { type: String, trim: true, maxlength: 100 },
  reference: { type: String, trim: true, maxlength: 120 },
  details: { type: String, trim: true, maxlength: 500 },
}, { _id: false })

const orderEventSchema = new Schema({
  type: { type: String, enum: ['order_status_changed', 'delivery_assigned', 'delivery_status_changed'], required: true },
  actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  actorRole: { type: String, enum: ['customer', 'admin', 'system'], required: true },
  from: { type: String, trim: true, maxlength: 40 },
  to: { type: String, trim: true, maxlength: 40 },
  createdAt: { type: Date, required: true, default: Date.now },
}, { _id: true, versionKey: false })

const orderSchema = new Schema({
  customerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  customerName: { type: String, required: true, trim: true, maxlength: 120 },
  customerPhone: { type: String, required: true, trim: true, maxlength: 32 },
  address: {
    line: { type: String, required: true, trim: true, maxlength: 300 },
    locality: { type: String, required: true, trim: true, maxlength: 120 },
    city: { type: String, required: true, default: 'Hyderabad', maxlength: 80 },
    postalCode: { type: String, trim: true, maxlength: 16, required: true },
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'],
    default: 'pending',
    required: true,
  },
  stockReservationState: {
    type: String,
    enum: ['reserving', 'reserved', 'releasing', 'consuming', 'released', 'consumed'],
    required: true,
    default: 'reserved',
  },
  reservationTargetStatus: {
    type: String,
    enum: ['cancelled', 'delivered'],
    default: null,
  },
  deliveryMethod: { type: String, enum: ['shop', 'third_party'], required: true },
  deliveryAssignment: { type: deliveryAssignmentSchema, default: undefined },
  events: { type: [orderEventSchema], default: [] },
  items: { type: [orderItemSchema], required: true, validate: (items: unknown[]) => items.length > 0 },
  subtotalPaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  deliveryFeePaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  totalPaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  idempotencyKey: { type: String, required: true, select: false },
  requestFingerprint: { type: String, required: true, select: false },
}, { timestamps: true, versionKey: false })

orderSchema.index({ idempotencyKey: 1 }, { unique: true })
orderSchema.index({ status: 1, createdAt: -1 })
orderSchema.index({ customerUserId: 1, createdAt: -1 })

export const Order = model('Order', orderSchema)
