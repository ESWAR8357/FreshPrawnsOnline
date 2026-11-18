import { Schema, model } from 'mongoose'

type StockFields = { onHandGrams: number }

const stockSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, unique: true },
  onHandGrams: { type: Number, required: true, min: 0, validate: Number.isSafeInteger, default: 0 },
  reservedGrams: {
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator(this: StockFields, value: number) {
        return Number.isSafeInteger(value) && value <= this.onHandGrams
      },
      message: 'reservedGrams must be an integer no greater than onHandGrams',
    },
    default: 0,
  },
  reservations: {
    type: [{
      orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
      grams: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    }],
    default: [],
  },
}, { timestamps: true, versionKey: false })

stockSchema.index({ 'reservations.orderId': 1 })

const stockMovementSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  deltaGrams: { type: Number, required: true, validate: Number.isSafeInteger },
  reason: { type: String, required: true, trim: true, maxlength: 120 },
  reference: { type: String, trim: true, maxlength: 160 },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false })

stockMovementSchema.index({ productId: 1, createdAt: -1 })

export const Stock = model('Stock', stockSchema)
export const StockMovement = model('StockMovement', stockMovementSchema)
