import { Schema, model } from 'mongoose'

const userSchema = new Schema({
  email: { type: String, trim: true, lowercase: true, required: true },
  passwordHash: { type: String, required: false, select: false },
  googleSubject: { type: String, required: false, select: false },
  role: { type: String, enum: ['customer', 'admin'], required: true, default: 'customer' },
  status: { type: String, enum: ['active', 'disabled'], required: true, default: 'active' },
}, { timestamps: true, versionKey: false })

userSchema.index({ email: 1 }, { unique: true })
userSchema.index({ googleSubject: 1 }, { unique: true, sparse: true })

export const User = model('User', userSchema)
