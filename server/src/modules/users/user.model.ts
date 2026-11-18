import { Schema, model } from 'mongoose'

const userSchema = new Schema({
  email: { type: String, trim: true, lowercase: true, required: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['customer', 'admin'], required: true, default: 'customer' },
  status: { type: String, enum: ['active', 'disabled'], required: true, default: 'active' },
}, { timestamps: true, versionKey: false })

userSchema.index({ email: 1 }, { unique: true })

export const User = model('User', userSchema)
