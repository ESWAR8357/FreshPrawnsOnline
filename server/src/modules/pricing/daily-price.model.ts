import { Schema, model } from 'mongoose'

const dailyPriceSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  pricePerKgPaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  effectiveFrom: { type: Date, required: true },
  effectiveTo: { type: Date, default: null },
  changedById: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, versionKey: false })

dailyPriceSchema.index({ productId: 1, effectiveFrom: -1 })
dailyPriceSchema.index({ productId: 1, effectiveFrom: 1 }, { unique: true })

export const DailyPrice = model('DailyPrice', dailyPriceSchema)
