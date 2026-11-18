import { Schema, model } from 'mongoose'

const orderItemSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
  productName: { type: String, required: true, trim: true },
  preparation: { type: String, enum: ['cleaned', 'uncleaned'], required: true },
  weightGrams: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  pricePerKgPaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  preparationFeePaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger, default: 0 },
  lineTotalPaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
}, { _id: false })

const orderSchema = new Schema({
  publicTrackingTokenHash: { type: String, required: true, select: false },
  customerUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  customerName: { type: String, required: true, trim: true, maxlength: 120 },
  customerPhone: { type: String, required: true, trim: true, maxlength: 32 },
  address: {
    line: { type: String, required: true, trim: true, maxlength: 300 },
    locality: { type: String, required: true, trim: true, maxlength: 120 },
    city: { type: String, required: true, default: 'Hyderabad', maxlength: 80 },
    postalCode: { type: String, trim: true, maxlength: 16 },
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'],
    default: 'pending',
    required: true,
  },
  deliveryMethod: { type: String, enum: ['shop', 'third_party'], required: true },
  items: { type: [orderItemSchema], required: true, validate: (items: unknown[]) => items.length > 0 },
  subtotalPaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  deliveryFeePaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  totalPaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  idempotencyKey: { type: String, required: true, select: false },
}, { timestamps: true, versionKey: false })

orderSchema.index({ publicTrackingTokenHash: 1 }, { unique: true })
orderSchema.index({ idempotencyKey: 1 }, { unique: true })
orderSchema.index({ status: 1, createdAt: -1 })
orderSchema.index({ customerUserId: 1, createdAt: -1 })

export const Order = model('Order', orderSchema)
