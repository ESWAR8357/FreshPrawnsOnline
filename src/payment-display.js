const paymentStatusLabels = {
  pending_collection: 'Pending collection',
  collected: 'Collected',
  not_collectible: 'Not collectible',
}

export function toPaymentDisplay(order) {
  return {
    paymentMethodLabel: order.paymentMethod === 'pay_on_delivery' ? 'Pay on delivery' : 'Unavailable',
    paymentStatus: paymentStatusLabels[order.paymentStatus] ? order.paymentStatus : 'pending_collection',
    paymentStatusLabel: paymentStatusLabels[order.paymentStatus] || 'Pending collection',
    paymentCollectedAt: order.paymentCollectedAt || null,
  }
}
