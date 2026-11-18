import { Schema, model } from 'mongoose'

const preparationOptionSchema = new Schema({
  type: { type: String, enum: ['cleaned', 'uncleaned'], required: true },
  enabled: { type: Boolean, default: true },
  feePaise: { type: Number, min: 0, validate: Number.isSafeInteger, default: 0 },
}, { _id: false })

const productSchema = new Schema({
  slug: {
    type: String,
    trim: true,
    lowercase: true,
    required: true,
    match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  },
  name: { type: String, trim: true, required: true, maxlength: 120 },
  description: { type: String, trim: true, default: '', maxlength: 2000 },
  longDescription: { type: String, trim: true, default: '', maxlength: 4000 },
  size: { type: String, enum: ['Small', 'Medium', 'Large'], trim: true, required: true },
  origin: { type: String, trim: true, default: 'Coastal catch', maxlength: 120 },
  badge: { type: String, trim: true, default: '', maxlength: 40 },
  imageUrl: {
    type: String,
    trim: true,
    validate: {
      validator: (value: string | undefined) => !value || (value.startsWith('https://') && URL.canParse(value)),
      message: 'imageUrl must be a valid HTTPS URL',
    },
  },
  imageKey: { type: String, trim: true },
  active: { type: Boolean, default: true },
  sampleData: { type: Boolean, default: false },
  preparationOptions: { type: [preparationOptionSchema], default: [] },
}, { timestamps: true, versionKey: false })

productSchema.index({ slug: 1 }, { unique: true })
productSchema.index({ active: 1, size: 1 })

export const Product = model('Product', productSchema)
