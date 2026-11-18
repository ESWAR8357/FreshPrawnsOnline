import { Schema, model } from 'mongoose'

const deliveryAssignmentSchema = new Schema({
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
  method: { type: String, enum: ['shop', 'third_party'], required: true },
  assigneeLabel: { type: String, trim: true, maxlength: 120 },
  providerReference: { type: String, trim: true, maxlength: 160 },
  status: { type: String, enum: ['unassigned', 'assigned', 'in_transit', 'completed', 'failed'], default: 'unassigned' },
  assignedAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false })

deliveryAssignmentSchema.index({ orderId: 1, assignedAt: -1 })

export const DeliveryAssignment = model('DeliveryAssignment', deliveryAssignmentSchema)
