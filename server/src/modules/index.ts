import { DailyPrice } from './pricing/daily-price.model.js'
import { DeliveryAssignment } from './delivery/delivery-assignment.model.js'
import { Order } from './orders/order.model.js'
import { Product } from './products/product.model.js'
import { Stock, StockMovement } from './inventory/stock.model.js'
import { User } from './users/user.model.js'

export async function initializeModelIndexes(): Promise<void> {
  await Promise.all([
    User.init(),
    Product.init(),
    DailyPrice.init(),
    Stock.init(),
    StockMovement.init(),
    Order.init(),
    DeliveryAssignment.init(),
  ])
}
