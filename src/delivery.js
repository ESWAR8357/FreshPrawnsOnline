export function toCustomerDelivery(assignment, orderMethod) {
  const method = assignment?.method || orderMethod
  const delivery = {
    method: method === 'third_party' ? 'third_party' : 'shop',
    status: assignment?.status || 'not_assigned',
  }
  if (delivery.method === 'shop') {
    if (assignment?.personName) delivery.personName = assignment.personName
    if (assignment?.personPhone) delivery.personPhone = assignment.personPhone
  } else {
    if (assignment?.serviceName) delivery.serviceName = assignment.serviceName
    if (assignment?.reference) delivery.reference = assignment.reference
  }
  return delivery
}

export function buildDeliveryAssignmentPayload(method, fields) {
  if (method === 'third_party') {
    const payload = { method, serviceName: fields.serviceName.trim() }
    if (fields.reference.trim()) payload.reference = fields.reference.trim()
    if (fields.details.trim()) payload.details = fields.details.trim()
    return payload
  }
  return {
    method: 'shop',
    personName: fields.personName.trim(),
    personPhone: fields.personPhone.trim(),
  }
}

export function deliveryStatusLabel(status) {
  return ({
    not_assigned: 'Not assigned',
    assigned: 'Assigned',
    picked_up: 'Picked up',
    in_transit: 'In transit',
    exception: 'Needs attention',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
  })[status] || 'Not assigned'
}
