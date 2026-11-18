import { Schema, model } from 'mongoose'

const preparationOptionSchema = new Schema({
  type: { type: String, enum: ['cleaned', 'uncleaned'], required: true },
  enabled: { type: Boolean, default: true },
  feePaise: { type: Number, min: 0, default: 0 },
}, { _id: false })

const productSchema = new Schema({
  slug: { type: String, trim: true, lowercase: true, required: true },
  name: { type: String, trim: true, required: true, maxlength: 120 },
  description: { type: String, trim: true, default: '', maxlength: 2000 },
  size: { type: String, trim: true, required: true },
  imageKey: { type: String, trim: true },
  active: { type: Boolean, default: true },
  preparationOptions: { type: [preparationOptionSchema], default: [] },
}, { timestamps: true, versionKey: false })

productSchema.index({ slug: 1 }, { unique: true })
productSchema.index({ active: 1, size: 1 })

export const Product = model('Product', productSchema)
